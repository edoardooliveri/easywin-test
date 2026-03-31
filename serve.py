#!/usr/bin/env python3
"""
easyWin — Unified server: static files + API
Extends SimpleHTTPRequestHandler for proxy compatibility
"""
import json, os, sys, sqlite3, uuid, re, base64
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta
from functools import partial

import bcrypt, jwt

JWT_SECRET = 'easywin-dev-secret-2026'
JWT_EXPIRY_HOURS = 24
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'easywin-gestionale', 'database', 'easywin.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def d(row): return dict(row) if row else None
def dl(rows): return [dict(r) for r in rows]

def create_token(uid, ruolo):
    return jwt.encode({'userId':uid,'ruolo':ruolo,'exp':datetime.utcnow()+timedelta(hours=JWT_EXPIRY_HOURS),'iat':datetime.utcnow()}, JWT_SECRET, algorithm='HS256')

def verify_token(tok):
    try: return jwt.decode(tok, JWT_SECRET, algorithms=['HS256'])
    except: return None

def get_user(headers):
    auth = headers.get('Authorization','')
    if not auth.startswith('Bearer '): return None
    dec = verify_token(auth[7:])
    if not dec: return None
    conn = get_db()
    u = conn.execute("SELECT id,username,email,nome,cognome,ruolo,stato FROM utenti WHERE id=?",(dec['userId'],)).fetchone()
    conn.close()
    if not u or dict(u)['stato']!='attivo': return None
    return dict(u)

TABLE_MAP = {'aziende':'aziende','stazioni':'stazioni_appaltanti','bandi':'bandi','esiti':'esiti','utenti':'utenti'}
SEARCH_COLS = {'aziende':['ragione_sociale','partita_iva','email'],'stazioni':['denominazione','codice_fiscale'],'bandi':['oggetto','codice_cig','stazione_denominazione'],'esiti':['oggetto','codice_cig','aggiudicatario_nome'],'utenti':['username','email','nome','cognome']}
FILTER_COLS = {'aziende':['stato','regione','provincia','tipo_abbonamento'],'stazioni':['regione','provincia','piattaforma'],'bandi':['stato','tipo_appalto','origine'],'esiti':['stato','origine'],'utenti':['ruolo','stato']}


class Handler(SimpleHTTPRequestHandler):

    def _json(self, data, status=200):
        body = json.dumps(data, default=str, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, s=400): self._json({'error':msg}, s)

    def _read_body(self):
        cl = int(self.headers.get('Content-Length',0))
        if cl==0: return {}
        try: return json.loads(self.rfile.read(cl))
        except: return {}

    def _auth(self):
        u = get_user(self.headers)
        if not u: self._err('Non autenticato',401)
        return u

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Content-Length','0')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qp = {k:v[0] if len(v)==1 else v for k,v in parse_qs(parsed.query).items()}

        if path.startswith('/api/'):
            m = qp.pop('_method','GET').upper()
            if m in ('POST','PUT'):
                bb = qp.pop('_body','')
                try: body = json.loads(base64.b64decode(bb).decode('utf-8')) if bb else {}
                except: body = {}
                if m=='POST': return self._route_post(path, body)
                else: return self._route_put(path, body)
            elif m=='DELETE':
                qp.pop('_body',None)
                return self._route_delete(path)
            return self._route_get(path, qp)

        # For all other paths, use standard static file serving
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            return self._route_post(parsed.path, self._read_body())
        self._err('Not found',404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            return self._route_put(parsed.path, self._read_body())
        self._err('Not found',404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            return self._route_delete(parsed.path)
        self._err('Not found',404)

    # ── GET routes ──
    def _route_get(self, path, qp):
        if path=='/api/health': return self._json({'status':'ok','version':'1.0.0','ts':datetime.now().isoformat()})
        if path=='/api/auth/me':
            u=self._auth()
            if u: self._json({'utente':u})
            return
        if path=='/api/dashboard':
            u=self._auth()
            if not u: return
            return self._dashboard()
        if path=='/api/dashboard/charts':
            u=self._auth()
            if not u: return
            return self._charts(qp)
        if path=='/api/ai-monitor/status':
            u=self._auth()
            if not u: return
            return self._ai_status()
        if path=='/api/ai-monitor/siti':
            return self._list('ai_siti_monitorati',qp,['nome'],[],'nome','ASC')
        if path=='/api/ai-monitor/atti-raw':
            return self._list('ai_atti_raw',qp,['titolo'],[],'data_scoperta','DESC')
        if path=='/api/esiti/review-queue':
            return self._review_queue()
        if path=='/api/email/log':
            return self._list('email_log',qp,['destinatario','oggetto'],[],'created_at','DESC')

        m = re.match(r'^/api/(aziende|stazioni|bandi|esiti|utenti)(?:/(.+))?$',path)
        if m:
            e,eid=m.group(1),m.group(2)
            u=self._auth()
            if not u: return
            if eid: return self._get_one(e,eid)
            t=TABLE_MAP.get(e,e)
            return self._list(t,qp,SEARCH_COLS.get(e,[]),FILTER_COLS.get(e,[]))
        self._err('Not found',404)

    # ── POST routes ──
    def _route_post(self, path, body):
        if path=='/api/auth/login': return self._login(body)
        u=self._auth()
        if not u: return
        m=re.match(r'^/api/(aziende|stazioni|bandi|esiti|utenti)$',path)
        if m: return self._create(m.group(1),body,u)
        am=re.match(r'^/api/esiti/([^/]+)/(conferma|scarta|pubblica)$',path)
        if am:
            acts={'conferma':'confermato','scarta':'scartato','pubblica':'pubblicato'}
            return self._esito_action(am.group(1),acts[am.group(2)],u)
        if path=='/api/ai-monitor/trigger-scan':
            return self._json({'messaggio':'Scansione avviata (AI non configurato)','stato':'simulazione'})
        self._err('Not found',404)

    # ── PUT routes ──
    def _route_put(self, path, body):
        u=self._auth()
        if not u: return
        m=re.match(r'^/api/(aziende|stazioni|bandi|esiti|utenti)/(.+)$',path)
        if m: return self._update(m.group(1),m.group(2),body,u)
        self._err('Not found',404)

    # ── DELETE routes ──
    def _route_delete(self, path):
        u=self._auth()
        if not u: return
        m=re.match(r'^/api/(aziende|stazioni|bandi|esiti|utenti)/(.+)$',path)
        if m: return self._delete(m.group(1),m.group(2),u)
        self._err('Not found',404)

    # ══════════════════════
    # Implementations
    # ══════════════════════
    def _login(self, body):
        un,pw=body.get('username',''),body.get('password','')
        if not un or not pw: return self._err('Username e password obbligatori')
        conn=get_db()
        u=conn.execute("SELECT * FROM utenti WHERE (username=? OR email=?) AND stato='attivo'",(un,un)).fetchone()
        if not u: conn.close(); return self._err('Credenziali non valide',401)
        ud=dict(u)
        if not bcrypt.checkpw(pw.encode(),ud['password_hash'].encode()): conn.close(); return self._err('Credenziali non valide',401)
        conn.execute("UPDATE utenti SET ultimo_accesso=datetime('now') WHERE id=?",(ud['id'],)); conn.commit(); conn.close()
        self._json({'token':create_token(ud['id'],ud['ruolo']),'utente':{'id':ud['id'],'username':ud['username'],'email':ud['email'],'nome':ud['nome'],'cognome':ud['cognome'],'ruolo':ud['ruolo']}})

    def _dashboard(self):
        conn=get_db()
        try:
            az=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='attiva' THEN 1 ELSE 0 END) as attive,SUM(CASE WHEN tipo_abbonamento IN ('premium','enterprise') THEN 1 ELSE 0 END) as premium FROM aziende").fetchone())
            ba=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN stato='in_corso' THEN 1 ELSE 0 END) as in_corso,SUM(CASE WHEN data_scadenza>datetime('now') AND stato='pubblicato' THEN 1 ELSE 0 END) as attivi,COALESCE(SUM(CASE WHEN stato!='revocato' THEN importo_base ELSE 0 END),0) as importo_totale FROM bandi").fetchone())
            es=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN stato='in_revisione' THEN 1 ELSE 0 END) as in_revisione,SUM(CASE WHEN stato='nuovo' THEN 1 ELSE 0 END) as nuovi,SUM(CASE WHEN created_at>datetime('now','-7 days') THEN 1 ELSE 0 END) as ultimi_7gg FROM esiti").fetchone())
            st=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN monitoraggio_attivo THEN 1 ELSE 0 END) as monitorate FROM stazioni_appaltanti").fetchone())
            ai=dict(conn.execute("SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END),0) as siti_attivi,COALESCE(SUM(CASE WHEN errori_consecutivi>0 THEN 1 ELSE 0 END),0) as con_errori,(SELECT COUNT(*) FROM ai_atti_raw WHERE NOT processato) as atti_da_processare FROM ai_siti_monitorati").fetchone())
            em=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='inviata' THEN 1 ELSE 0 END) as inviate,SUM(CASE WHEN stato='errore' THEN 1 ELSE 0 END) as errori,SUM(CASE WHEN stato='in_coda' THEN 1 ELSE 0 END) as in_coda FROM email_log").fetchone())
            act=dl(conn.execute("SELECT azione,entita_tipo,dettagli,created_at FROM activity_log ORDER BY created_at DESC LIMIT 10").fetchall())
            self._json({'aziende':az,'bandi':ba,'esiti':es,'stazioni':st,'ai':ai,'email':em,'attivita_recente':act})
        finally: conn.close()

    def _charts(self, qp):
        conn=get_db()
        try:
            g=int(qp.get('periodo',30))
            epg=dl(conn.execute("SELECT date(created_at) as giorno,COUNT(*) as conteggio FROM esiti WHERE created_at>datetime('now',?) GROUP BY date(created_at) ORDER BY giorno",(f'-{g} days',)).fetchall())
            bpt=dl(conn.execute("SELECT tipo_appalto,COUNT(*) as conteggio FROM bandi WHERE tipo_appalto IS NOT NULL GROUP BY tipo_appalto ORDER BY conteggio DESC").fetchall())
            epo=dl(conn.execute("SELECT origine,COUNT(*) as conteggio FROM esiti GROUP BY origine ORDER BY conteggio DESC").fetchall())
            self._json({'esiti_per_giorno':epg,'bandi_per_tipo':bpt,'esiti_per_origine':epo})
        finally: conn.close()

    def _ai_status(self):
        conn=get_db()
        try:
            s=dict(conn.execute("SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END),0) as attivi,COUNT(*) as totali,COALESCE(SUM(CASE WHEN errori_consecutivi>0 THEN 1 ELSE 0 END),0) as con_errori,MAX(ultimo_scraping) as ultimo_scraping FROM ai_siti_monitorati").fetchone())
            a=dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN NOT processato THEN 1 ELSE 0 END) as da_processare,SUM(CASE WHEN processato AND esito_id IS NOT NULL THEN 1 ELSE 0 END) as convertiti_in_esiti FROM ai_atti_raw").fetchone())
            ea=dict(conn.execute("SELECT SUM(CASE WHEN stato='nuovo' THEN 1 ELSE 0 END) as nuovi,SUM(CASE WHEN stato='in_revisione' THEN 1 ELSE 0 END) as in_revisione,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN origine IN ('ai_albo_pretorio','ai_stazione_appaltante','ai_piattaforma') THEN 1 ELSE 0 END) as totali_ai FROM esiti").fetchone())
            cr=conn.execute("SELECT chiave,valore FROM configurazione WHERE chiave LIKE 'ai_%'").fetchall()
            self._json({'siti_monitorati':s,'atti_raw':a,'esiti_ai':ea,'configurazione':{r['chiave']:r['valore'] for r in cr}})
        finally: conn.close()

    def _review_queue(self):
        u=self._auth()
        if not u: return
        conn=get_db()
        try:
            rows=dl(conn.execute("SELECT e.*,s.denominazione as stazione_nome FROM esiti e LEFT JOIN stazioni_appaltanti s ON e.stazione_appaltante_id=s.id WHERE e.stato IN ('in_revisione','nuovo') ORDER BY e.ai_confidence DESC,e.created_at DESC LIMIT 100").fetchall())
            self._json({'dati':rows,'totale':len(rows)})
        finally: conn.close()

    def _esito_action(self, eid, stato, user):
        conn=get_db()
        try:
            conn.execute("UPDATE esiti SET stato=?,verificato_da=? WHERE id=?",(stato,user['id'],eid)); conn.commit()
            r=d(conn.execute("SELECT * FROM esiti WHERE id=?",(eid,)).fetchone())
            if r: self._json(r)
            else: self._err('Non trovato',404)
        finally: conn.close()

    def _list(self, table, qp, scols=None, fcols=None, dsort='created_at', dord='DESC'):
        u=self._auth()
        if not u: return
        conn=get_db()
        try:
            page=int(qp.get('page',1)); lim=min(int(qp.get('limit',50)),200); off=(page-1)*lim
            search=qp.get('search',''); sort=re.sub(r'[^a-zA-Z_]','',qp.get('sort',dsort)); order='ASC' if qp.get('order','')=='ASC' else dord
            conds,params=[],[]
            if search and scols:
                conds.append('('+' OR '.join(f"{c} LIKE ?" for c in scols)+')')
                params.extend([f'%{search}%']*len(scols))
            if fcols:
                for c in fcols:
                    v=qp.get(c)
                    if v: conds.append(f"{c}=?"); params.append(v)
            w='WHERE '+' AND '.join(conds) if conds else ''
            tot=conn.execute(f"SELECT COUNT(*) as count FROM {table} {w}",params).fetchone()['count']
            data=dl(conn.execute(f"SELECT * FROM {table} {w} ORDER BY {sort} {order} LIMIT ? OFFSET ?",params+[lim,off]).fetchall())
            self._json({'dati':data,'totale':tot,'pagina':page,'pagine':max(1,-(-tot//lim))})
        finally: conn.close()

    def _get_one(self, entity, eid):
        t=TABLE_MAP.get(entity,entity); conn=get_db()
        try:
            r=d(conn.execute(f"SELECT * FROM {t} WHERE id=?",(eid,)).fetchone())
            if not r: return self._err(f'{entity} non trovato',404)
            self._json(r)
        finally: conn.close()

    def _create(self, entity, body, user):
        t=TABLE_MAP.get(entity,entity); conn=get_db()
        try:
            nid=str(uuid.uuid4())
            if entity=='utenti':
                pw=body.get('password','')
                if len(pw)<8: return self._err('Password minimo 8 caratteri')
                ph=bcrypt.hashpw(pw.encode(),bcrypt.gensalt()).decode()
                conn.execute("INSERT INTO utenti (id,username,email,password_hash,nome,cognome,ruolo) VALUES (?,?,?,?,?,?,?)",(nid,body.get('username'),body.get('email'),ph,body.get('nome'),body.get('cognome'),body.get('ruolo','viewer')))
            else:
                f={k:v for k,v in body.items() if k!='id' and not k.startswith('_')}
                if not f: return self._err('Nessun dato')
                cols=['id']+list(f.keys()); vals=[nid]+list(f.values())
                conn.execute(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",vals)
            conn.commit()
            self._json(d(conn.execute(f"SELECT * FROM {t} WHERE id=?",(nid,)).fetchone()),201)
        except sqlite3.IntegrityError as e: self._err(f'Duplicato: {e}',409)
        finally: conn.close()

    def _update(self, entity, eid, body, user):
        t=TABLE_MAP.get(entity,entity); conn=get_db()
        try:
            f={k:v for k,v in body.items() if k not in ('id','created_at','password_hash') and not k.startswith('_')}
            if not f: return self._err('Nessun campo')
            sc=','.join(f"{k}=?" for k in f); vals=list(f.values())+[eid]
            conn.execute(f"UPDATE {t} SET {sc},updated_at=datetime('now') WHERE id=?",vals); conn.commit()
            r=d(conn.execute(f"SELECT * FROM {t} WHERE id=?",(eid,)).fetchone())
            if not r: return self._err('Non trovato',404)
            self._json(r)
        finally: conn.close()

    def _delete(self, entity, eid, user):
        t=TABLE_MAP.get(entity,entity); conn=get_db()
        try:
            if not conn.execute(f"SELECT id FROM {t} WHERE id=?",(eid,)).fetchone(): return self._err('Non trovato',404)
            conn.execute(f"DELETE FROM {t} WHERE id=?",(eid,)); conn.commit()
            self._json({'messaggio':f'{entity} eliminato'})
        finally: conn.close()

    def log_message(self, format, *args):
        pass  # quiet logging


if __name__ == '__main__':
    # Initialize DB
    conn = get_db()
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'easywin-gestionale', 'database', 'sqlite-schema.sql')
    if os.path.exists(schema_path):
        conn.executescript(open(schema_path).read())
    # Seed admin
    if not conn.execute("SELECT id FROM utenti WHERE username=?",('admin',)).fetchone():
        ph = bcrypt.hashpw(b'admin123', bcrypt.gensalt()).decode()
        conn.execute("INSERT INTO utenti (id,username,email,password_hash,nome,cognome,ruolo,stato) VALUES (?,?,?,?,?,?,?,?)",
                     (str(uuid.uuid4()),'admin','admin@easywin.it',ph,'Amministratore','Sistema','administrator','attivo'))
        conn.commit()
    # Seed data
    if conn.execute("SELECT COUNT(*) FROM aziende").fetchone()[0] == 0:
        for az in [('Costruzioni Rossi S.r.l.','01234567890','Via Roma 1','Genova','GE','16100','Liguria','premium','attiva'),('Impresa Bianchi S.p.A.','09876543210','Via Milano 15','Milano','MI','20100','Lombardia','enterprise','attiva'),('Edilizia Verdi & C.','05432109876','Via Napoli 8','Roma','RM','00100','Lazio','standard','attiva'),('Servizi Tecnici Neri','06789012345','Via Torino 22','Torino','TO','10100','Piemonte','base','attiva'),('Appalti Italia S.r.l.','02345678901','Via Firenze 3','Firenze','FI','50100','Toscana','premium','attiva'),('Infrastrutture Sud S.r.l.','03456789012','Via Bari 11','Bari','BA','70100','Puglia','standard','attiva'),('Cooperativa Edile Alpha','04567890123','Via Bologna 7','Bologna','BO','40100','Emilia-Romagna','premium','attiva'),('Global Services S.p.A.','05678901234','Via Venezia 5','Venezia','VE','30100','Veneto','enterprise','attiva')]:
            conn.execute("INSERT OR IGNORE INTO aziende (id,ragione_sociale,partita_iva,indirizzo,citta,provincia,cap,regione,tipo_abbonamento,stato) VALUES (?,?,?,?,?,?,?,?,?,?)",(str(uuid.uuid4()),*az))
        for st in [('Comune di Genova','Genova','GE','Liguria','Comune','Halley',1),('Comune di Milano','Milano','MI','Lombardia','Comune','Maggioli',1),('Comune di Roma Capitale','Roma','RM','Lazio','Comune','JCityGov',0),('ASL 3 Genovese','Genova','GE','Liguria','ASL','Halley',1),('Provincia di Torino','Torino','TO','Piemonte','Provincia','Maggioli',0),('Università di Bologna','Bologna','BO','Emilia-Romagna','Università','Sintel',1)]:
            conn.execute("INSERT OR IGNORE INTO stazioni_appaltanti (id,denominazione,citta,provincia,regione,tipologia,piattaforma,monitoraggio_attivo) VALUES (?,?,?,?,?,?,?,?)",(str(uuid.uuid4()),*st))
        for b in [('Z123456789','Lavori di manutenzione straordinaria edifici scolastici',250000,'Lavori','Aperta','Prezzo più basso','pubblicato','Comune di Genova'),('Z987654321','Fornitura arredi uffici comunali',85000,'Forniture','Negoziata','OEPV','in_corso','Comune di Milano'),('Z555555555','Servizio di pulizia edifici pubblici triennale',450000,'Servizi','Aperta','OEPV','pubblicato','Comune di Roma Capitale'),('Z444444444','Ristrutturazione palestra comunale',180000,'Lavori','Ristretta','Prezzo più basso','pubblicato','ASL 3 Genovese'),('Z666666666','Fornitura attrezzature informatiche',65000,'Forniture','Negoziata','OEPV','scaduto','Università di Bologna')]:
            conn.execute("INSERT OR IGNORE INTO bandi (id,codice_cig,oggetto,importo_base,tipo_appalto,tipo_procedura,criterio_aggiudicazione,stato,stazione_denominazione,data_pubblicazione,origine) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),'manuale')",(str(uuid.uuid4()),*b))
        for e in [('Z111111111','Esito gara manutenzione strade comunali',180000,15.5,'Costruzioni Rossi S.r.l.','01234567890',8,'pubblicato','manuale','Comune di Genova',None),('Z222222222','Esito affidamento servizio trasporti',95000,8.2,'Servizi Tecnici Neri','06789012345',5,'in_revisione','ai_albo_pretorio','Comune di Milano',82.5),('Z333333333','Esito gara fornitura attrezzature informatiche',42000,12.0,'Appalti Italia S.r.l.','02345678901',3,'nuovo','ai_albo_pretorio','ASL 3 Genovese',76.3),('Z777777777','Esito lavori rifacimento marciapiedi',320000,18.7,'Impresa Bianchi S.p.A.','09876543210',12,'confermato','ai_albo_pretorio','Comune di Genova',91.2),('Z888888888','Esito servizio mensa scolastica',156000,5.8,'Global Services S.p.A.','05678901234',6,'pubblicato','manuale','Provincia di Torino',None)]:
            conn.execute("INSERT OR IGNORE INTO esiti (id,codice_cig,oggetto,importo_aggiudicazione,ribasso_percentuale,aggiudicatario_nome,aggiudicatario_piva,numero_partecipanti,stato,origine,stazione_denominazione,data_aggiudicazione,ai_confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,date('now','-'||(abs(random())%30)||' days'),?)",(str(uuid.uuid4()),*e))
        conn.commit()
    conn.close()

    directory = os.path.dirname(os.path.abspath(__file__))
    handler = partial(Handler, directory=directory)
    server = HTTPServer(('0.0.0.0', 8080), handler)
    print(f'[SERVER] http://localhost:8080 — admin: admin/admin123')
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
