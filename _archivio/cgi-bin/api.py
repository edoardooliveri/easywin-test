#!/usr/bin/env python3
"""
easyWin Gestionale — CGI API Gateway
Handles all /cgi-bin/api.py requests routed from the frontend
"""

import json
import os
import sys
import sqlite3
import uuid
import cgi
import re
from datetime import datetime, timedelta
from urllib.parse import parse_qs

import bcrypt
import jwt

# ── Config ──
JWT_SECRET = 'easywin-dev-secret-2026'
JWT_EXPIRY_HOURS = 24
DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'easywin-gestionale', 'database', 'easywin.db')

# ── Database ──
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def dict_row(row):
    return dict(row) if row else None

def rows_list(rows):
    return [dict(r) for r in rows]

# ── JWT ──
def create_token(user_id, ruolo):
    payload = {
        'userId': user_id,
        'ruolo': ruolo,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def verify_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except:
        return None

def get_user():
    auth = os.environ.get('HTTP_AUTHORIZATION', '')
    if not auth.startswith('Bearer '):
        return None
    decoded = verify_token(auth[7:])
    if not decoded:
        return None
    conn = get_db()
    user = conn.execute(
        "SELECT id, username, email, nome, cognome, ruolo, stato FROM utenti WHERE id = ?",
        (decoded['userId'],)
    ).fetchone()
    conn.close()
    if not user or dict(user)['stato'] != 'attivo':
        return None
    return dict(user)

# ── Response helpers ──
def send_json(data, status=200):
    body = json.dumps(data, default=str, ensure_ascii=False)
    status_text = {200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error'}
    print(f"Status: {status} {status_text.get(status, 'OK')}")
    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print("Access-Control-Allow-Headers: Content-Type, Authorization")
    print("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS")
    print()
    print(body)

def send_error(msg, status=400):
    send_json({'error': msg}, status)

# ── Read request body ──
def read_body():
    try:
        length = int(os.environ.get('CONTENT_LENGTH', 0))
        if length == 0:
            return {}
        raw = sys.stdin.buffer.read(length)
        return json.loads(raw)
    except:
        return {}

# ── API implementations ──

def api_login(body):
    username = body.get('username', '')
    password = body.get('password', '')
    if not username or not password:
        return send_error('Username e password obbligatori')

    conn = get_db()
    user = conn.execute(
        "SELECT * FROM utenti WHERE (username = ? OR email = ?) AND stato = 'attivo'",
        (username, username)
    ).fetchone()

    if not user:
        conn.close()
        return send_error('Credenziali non valide', 401)

    user_dict = dict(user)
    if not bcrypt.checkpw(password.encode('utf-8'), user_dict['password_hash'].encode('utf-8')):
        conn.close()
        return send_error('Credenziali non valide', 401)

    conn.execute("UPDATE utenti SET ultimo_accesso = datetime('now') WHERE id = ?", (user_dict['id'],))
    conn.commit()
    conn.close()

    token = create_token(user_dict['id'], user_dict['ruolo'])
    send_json({
        'token': token,
        'utente': {
            'id': user_dict['id'],
            'username': user_dict['username'],
            'email': user_dict['email'],
            'nome': user_dict['nome'],
            'cognome': user_dict['cognome'],
            'ruolo': user_dict['ruolo'],
        }
    })

def api_auth_me():
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)
    send_json({'utente': user})

def api_dashboard():
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        aziende = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN stato = 'attiva' THEN 1 ELSE 0 END) as attive,
            SUM(CASE WHEN tipo_abbonamento IN ('premium','enterprise') THEN 1 ELSE 0 END) as premium
            FROM aziende
        """).fetchone())

        bandi = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN stato = 'pubblicato' THEN 1 ELSE 0 END) as pubblicati,
            SUM(CASE WHEN stato = 'in_corso' THEN 1 ELSE 0 END) as in_corso,
            SUM(CASE WHEN data_scadenza > datetime('now') AND stato = 'pubblicato' THEN 1 ELSE 0 END) as attivi,
            COALESCE(SUM(CASE WHEN stato != 'revocato' THEN importo_base ELSE 0 END), 0) as importo_totale
            FROM bandi
        """).fetchone())

        esiti = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN stato = 'pubblicato' THEN 1 ELSE 0 END) as pubblicati,
            SUM(CASE WHEN stato = 'in_revisione' THEN 1 ELSE 0 END) as in_revisione,
            SUM(CASE WHEN stato = 'nuovo' THEN 1 ELSE 0 END) as nuovi,
            SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) as ultimi_7gg
            FROM esiti
        """).fetchone())

        stazioni = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN monitoraggio_attivo THEN 1 ELSE 0 END) as monitorate
            FROM stazioni_appaltanti
        """).fetchone())

        ai = dict(conn.execute("""
            SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END), 0) as siti_attivi,
            COALESCE(SUM(CASE WHEN errori_consecutivi > 0 THEN 1 ELSE 0 END), 0) as con_errori,
            (SELECT COUNT(*) FROM ai_atti_raw WHERE NOT processato) as atti_da_processare
            FROM ai_siti_monitorati
        """).fetchone())

        email = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN stato = 'inviata' THEN 1 ELSE 0 END) as inviate,
            SUM(CASE WHEN stato = 'errore' THEN 1 ELSE 0 END) as errori,
            SUM(CASE WHEN stato = 'in_coda' THEN 1 ELSE 0 END) as in_coda
            FROM email_log
        """).fetchone())

        attivita = rows_list(conn.execute(
            "SELECT azione, entita_tipo, dettagli, created_at FROM activity_log ORDER BY created_at DESC LIMIT 10"
        ).fetchall())

        send_json({
            'aziende': aziende,
            'bandi': bandi,
            'esiti': esiti,
            'stazioni': stazioni,
            'ai': ai,
            'email': email,
            'attivita_recente': attivita,
        })
    finally:
        conn.close()

def api_dashboard_charts(qp):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        giorni = int(qp.get('periodo', ['30'])[0]) if isinstance(qp.get('periodo'), list) else int(qp.get('periodo', 30))
        esiti_per_giorno = rows_list(conn.execute(
            "SELECT date(created_at) as giorno, COUNT(*) as conteggio FROM esiti WHERE created_at > datetime('now', ?) GROUP BY date(created_at) ORDER BY giorno",
            (f'-{giorni} days',)
        ).fetchall())

        bandi_per_tipo = rows_list(conn.execute(
            "SELECT tipo_appalto, COUNT(*) as conteggio FROM bandi WHERE tipo_appalto IS NOT NULL GROUP BY tipo_appalto ORDER BY conteggio DESC"
        ).fetchall())

        esiti_per_origine = rows_list(conn.execute(
            "SELECT origine, COUNT(*) as conteggio FROM esiti GROUP BY origine ORDER BY conteggio DESC"
        ).fetchall())

        send_json({
            'esiti_per_giorno': esiti_per_giorno,
            'bandi_per_tipo': bandi_per_tipo,
            'esiti_per_origine': esiti_per_origine,
        })
    finally:
        conn.close()

def api_ai_monitor_status():
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        siti = dict(conn.execute("""
            SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END), 0) as attivi,
            COUNT(*) as totali,
            COALESCE(SUM(CASE WHEN errori_consecutivi > 0 THEN 1 ELSE 0 END), 0) as con_errori,
            MAX(ultimo_scraping) as ultimo_scraping
            FROM ai_siti_monitorati
        """).fetchone())

        atti = dict(conn.execute("""
            SELECT COUNT(*) as totali,
            SUM(CASE WHEN NOT processato THEN 1 ELSE 0 END) as da_processare,
            SUM(CASE WHEN processato AND esito_id IS NOT NULL THEN 1 ELSE 0 END) as convertiti_in_esiti
            FROM ai_atti_raw
        """).fetchone())

        esiti_ai = dict(conn.execute("""
            SELECT SUM(CASE WHEN stato = 'nuovo' THEN 1 ELSE 0 END) as nuovi,
            SUM(CASE WHEN stato = 'in_revisione' THEN 1 ELSE 0 END) as in_revisione,
            SUM(CASE WHEN stato = 'pubblicato' THEN 1 ELSE 0 END) as pubblicati,
            SUM(CASE WHEN origine IN ('ai_albo_pretorio','ai_stazione_appaltante','ai_piattaforma') THEN 1 ELSE 0 END) as totali_ai
            FROM esiti
        """).fetchone())

        config_rows = conn.execute("SELECT chiave, valore FROM configurazione WHERE chiave LIKE 'ai_%'").fetchall()
        config = {r['chiave']: r['valore'] for r in config_rows}

        send_json({
            'siti_monitorati': siti,
            'atti_raw': atti,
            'esiti_ai': esiti_ai,
            'configurazione': config,
        })
    finally:
        conn.close()

def api_esiti_review_queue():
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        rows = rows_list(conn.execute("""
            SELECT e.*, s.denominazione as stazione_nome
            FROM esiti e
            LEFT JOIN stazioni_appaltanti s ON e.stazione_appaltante_id = s.id
            WHERE e.stato IN ('in_revisione', 'nuovo')
            ORDER BY e.ai_confidence DESC, e.created_at DESC
            LIMIT 100
        """).fetchall())
        send_json({'dati': rows, 'totale': len(rows)})
    finally:
        conn.close()

def api_esito_action(esito_id, new_stato):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        conn.execute("UPDATE esiti SET stato = ?, verificato_da = ? WHERE id = ?",
                     (new_stato, user['id'], esito_id))
        conn.commit()
        esito = dict_row(conn.execute("SELECT * FROM esiti WHERE id = ?", (esito_id,)).fetchone())
        if esito:
            send_json(esito)
        else:
            send_error('Esito non trovato', 404)
    finally:
        conn.close()

# ── Generic CRUD ──
TABLE_MAP = {
    'aziende': 'aziende',
    'stazioni': 'stazioni_appaltanti',
    'bandi': 'bandi',
    'esiti': 'esiti',
    'utenti': 'utenti',
}

SEARCH_COLS = {
    'aziende': ['ragione_sociale', 'partita_iva', 'email'],
    'stazioni': ['denominazione', 'codice_fiscale'],
    'bandi': ['oggetto', 'codice_cig', 'stazione_denominazione'],
    'esiti': ['oggetto', 'codice_cig', 'aggiudicatario_nome'],
    'utenti': ['username', 'email', 'nome', 'cognome'],
}

FILTER_COLS = {
    'aziende': ['stato', 'regione', 'provincia', 'tipo_abbonamento'],
    'stazioni': ['regione', 'provincia', 'piattaforma'],
    'bandi': ['stato', 'tipo_appalto', 'origine'],
    'esiti': ['stato', 'origine'],
    'utenti': ['ruolo', 'stato'],
}

def api_list(table, qp, search_cols=None, filter_cols=None, default_sort='created_at', default_order='DESC'):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    conn = get_db()
    try:
        # Handle query params (may be lists from parse_qs)
        def qval(key, default=''):
            v = qp.get(key, default)
            if isinstance(v, list):
                return v[0]
            return v

        page = int(qval('page', '1'))
        limit = min(int(qval('limit', '50')), 200)
        offset = (page - 1) * limit
        search = qval('search', '')
        sort = qval('sort', default_sort)
        order = qval('order', default_order)

        conditions = []
        params = []

        if search and search_cols:
            or_clauses = [f"{col} LIKE ?" for col in search_cols]
            conditions.append(f"({' OR '.join(or_clauses)})")
            params.extend([f'%{search}%'] * len(search_cols))

        if filter_cols:
            for col in filter_cols:
                val = qval(col, '')
                if val:
                    conditions.append(f"{col} = ?")
                    params.append(val)

        where = 'WHERE ' + ' AND '.join(conditions) if conditions else ''
        order_dir = 'ASC' if order == 'ASC' else 'DESC'
        safe_sort = re.sub(r'[^a-zA-Z_]', '', sort)

        count_result = conn.execute(f"SELECT COUNT(*) as count FROM {table} {where}", params).fetchone()
        totale = count_result['count'] if count_result else 0

        data = rows_list(conn.execute(
            f"SELECT * FROM {table} {where} ORDER BY {safe_sort} {order_dir} LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall())

        send_json({
            'dati': data,
            'totale': totale,
            'pagina': page,
            'pagine': max(1, -(-totale // limit)),
        })
    finally:
        conn.close()

def api_get_one(entity, entity_id):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    table = TABLE_MAP.get(entity, entity)
    conn = get_db()
    try:
        row = dict_row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (entity_id,)).fetchone())
        if not row:
            return send_error(f'{entity} non trovato', 404)
        send_json(row)
    finally:
        conn.close()

def api_create(entity, body):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    table = TABLE_MAP.get(entity, entity)
    conn = get_db()
    try:
        new_id = str(uuid.uuid4())

        if entity == 'utenti':
            pw = body.get('password', '')
            if len(pw) < 8:
                return send_error('Password minimo 8 caratteri')
            pw_hash = bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            conn.execute(
                "INSERT INTO utenti (id, username, email, password_hash, nome, cognome, ruolo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_id, body.get('username'), body.get('email'), pw_hash, body.get('nome'), body.get('cognome'), body.get('ruolo', 'viewer'))
            )
        else:
            fields = {k: v for k, v in body.items() if k != 'id' and not k.startswith('_')}
            if not fields:
                return send_error('Nessun dato fornito')
            cols = ['id'] + list(fields.keys())
            placeholders = ', '.join(['?'] * len(cols))
            values = [new_id] + list(fields.values())
            conn.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})", values)

        conn.commit()
        created = dict_row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (new_id,)).fetchone())
        send_json(created, 201)
    except sqlite3.IntegrityError as e:
        send_error(f'Dati duplicati: {str(e)}', 409)
    finally:
        conn.close()

def api_update(entity, entity_id, body):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    table = TABLE_MAP.get(entity, entity)
    conn = get_db()
    try:
        fields = {k: v for k, v in body.items() if k not in ('id', 'created_at', 'password_hash') and not k.startswith('_')}
        if not fields:
            return send_error('Nessun campo da aggiornare')

        set_clause = ', '.join([f"{k} = ?" for k in fields.keys()])
        values = list(fields.values()) + [entity_id]
        conn.execute(f"UPDATE {table} SET {set_clause}, updated_at = datetime('now') WHERE id = ?", values)
        conn.commit()

        updated = dict_row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (entity_id,)).fetchone())
        if not updated:
            return send_error('Non trovato', 404)
        send_json(updated)
    finally:
        conn.close()

def api_delete(entity, entity_id):
    user = get_user()
    if not user:
        return send_error('Non autenticato', 401)

    table = TABLE_MAP.get(entity, entity)
    conn = get_db()
    try:
        existing = conn.execute(f"SELECT id FROM {table} WHERE id = ?", (entity_id,)).fetchone()
        if not existing:
            return send_error('Non trovato', 404)
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (entity_id,))
        conn.commit()
        send_json({'messaggio': f'{entity} eliminato'})
    finally:
        conn.close()

# ── Main Router ──
def main():
    method = os.environ.get('REQUEST_METHOD', 'GET')
    query_string = os.environ.get('QUERY_STRING', '')
    qp = parse_qs(query_string)

    # Get the API path from query param
    path = qp.get('path', [''])[0] if 'path' in qp else ''
    if not path.startswith('/'):
        path = '/' + path

    # Handle OPTIONS (CORS preflight)
    if method == 'OPTIONS':
        print("Status: 200 OK")
        print("Content-Type: text/plain")
        print("Content-Length: 0")
        print("Access-Control-Allow-Origin: *")
        print("Access-Control-Allow-Headers: Content-Type, Authorization")
        print("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS")
        print()
        return

    body = read_body() if method in ('POST', 'PUT') else {}

    try:
        # ── Auth routes ──
        if path == '/auth/login' and method == 'POST':
            return api_login(body)

        if path == '/auth/me':
            return api_auth_me()

        if path == '/health':
            return send_json({'status': 'ok', 'version': '1.0.0', 'timestamp': datetime.now().isoformat()})

        # ── Dashboard ──
        if path == '/dashboard':
            return api_dashboard()

        if path == '/dashboard/charts':
            return api_dashboard_charts(qp)

        # ── AI Monitor ──
        if path == '/ai-monitor/status':
            user = get_user()
            if not user: return send_error('Non autenticato', 401)
            return api_ai_monitor_status()

        if path == '/ai-monitor/siti':
            return api_list('ai_siti_monitorati', qp, search_cols=['nome'], default_sort='nome')

        if path == '/ai-monitor/atti-raw':
            return api_list('ai_atti_raw', qp, search_cols=['titolo'], default_sort='data_scoperta', default_order='DESC')

        if path == '/ai-monitor/trigger-scan' and method == 'POST':
            user = get_user()
            if not user: return send_error('Non autenticato', 401)
            return send_json({'messaggio': 'Scansione avviata (motore AI non ancora configurato)', 'stato': 'simulazione'})

        # ── Esiti special routes ──
        esito_action_match = re.match(r'^/esiti/([^/]+)/(conferma|scarta|pubblica)$', path)
        if esito_action_match and method == 'POST':
            esito_id = esito_action_match.group(1)
            action_map = {'conferma': 'confermato', 'scarta': 'scartato', 'pubblica': 'pubblicato'}
            return api_esito_action(esito_id, action_map[esito_action_match.group(2)])

        if path == '/esiti/review-queue':
            return api_esiti_review_queue()

        # ── Email log ──
        if path == '/email/log':
            return api_list('email_log', qp, search_cols=['destinatario', 'oggetto'], default_sort='created_at', default_order='DESC')

        # ── Generic CRUD ──
        entity_match = re.match(r'^/(aziende|stazioni|bandi|esiti|utenti)(?:/(.+))?$', path)
        if entity_match:
            entity = entity_match.group(1)
            entity_id = entity_match.group(2)

            if method == 'GET':
                if entity_id:
                    return api_get_one(entity, entity_id)
                else:
                    table = TABLE_MAP.get(entity, entity)
                    search_cols = SEARCH_COLS.get(entity, [])
                    filter_cols = FILTER_COLS.get(entity, [])
                    return api_list(table, qp, search_cols=search_cols, filter_cols=filter_cols)

            elif method == 'POST':
                return api_create(entity, body)

            elif method == 'PUT' and entity_id:
                return api_update(entity, entity_id, body)

            elif method == 'DELETE' and entity_id:
                return api_delete(entity, entity_id)

        send_error('Endpoint non trovato: ' + path, 404)

    except Exception as e:
        send_error(f'Errore server: {str(e)}', 500)


if __name__ == '__main__':
    main()
