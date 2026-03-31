#!/usr/bin/env python3
"""Export database to static JSON files for frontend consumption"""
import json, sqlite3, os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'easywin-gestionale', 'database', 'easywin.db')
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(OUT_DIR, exist_ok=True)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
dl = lambda rows: [dict(r) for r in rows]

def save(name, data):
    with open(os.path.join(OUT_DIR, name), 'w') as f:
        json.dump(data, f, default=str, ensure_ascii=False, indent=2)
    print(f'  -> {name}')

# Dashboard
az = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='attiva' THEN 1 ELSE 0 END) as attive,SUM(CASE WHEN tipo_abbonamento IN ('premium','enterprise') THEN 1 ELSE 0 END) as premium FROM aziende").fetchone())
ba = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN stato='in_corso' THEN 1 ELSE 0 END) as in_corso,SUM(CASE WHEN data_scadenza>datetime('now') AND stato='pubblicato' THEN 1 ELSE 0 END) as attivi,COALESCE(SUM(CASE WHEN stato!='revocato' THEN importo_base ELSE 0 END),0) as importo_totale FROM bandi").fetchone())
es = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN stato='in_revisione' THEN 1 ELSE 0 END) as in_revisione,SUM(CASE WHEN stato='nuovo' THEN 1 ELSE 0 END) as nuovi,SUM(CASE WHEN created_at>datetime('now','-7 days') THEN 1 ELSE 0 END) as ultimi_7gg FROM esiti").fetchone())
st = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN monitoraggio_attivo THEN 1 ELSE 0 END) as monitorate FROM stazioni_appaltanti").fetchone())
ai = dict(conn.execute("SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END),0) as siti_attivi,COALESCE(SUM(CASE WHEN errori_consecutivi>0 THEN 1 ELSE 0 END),0) as con_errori,(SELECT COUNT(*) FROM ai_atti_raw WHERE NOT processato) as atti_da_processare FROM ai_siti_monitorati").fetchone())
em = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN stato='inviata' THEN 1 ELSE 0 END) as inviate,SUM(CASE WHEN stato='errore' THEN 1 ELSE 0 END) as errori,SUM(CASE WHEN stato='in_coda' THEN 1 ELSE 0 END) as in_coda FROM email_log").fetchone())
act = dl(conn.execute("SELECT azione,entita_tipo,dettagli,created_at FROM activity_log ORDER BY created_at DESC LIMIT 10").fetchall())
save('dashboard.json', {'aziende':az,'bandi':ba,'esiti':es,'stazioni':st,'ai':ai,'email':em,'attivita_recente':act})

# Charts
epg = dl(conn.execute("SELECT date(created_at) as giorno,COUNT(*) as conteggio FROM esiti WHERE created_at>datetime('now','-30 days') GROUP BY date(created_at) ORDER BY giorno").fetchall())
bpt = dl(conn.execute("SELECT tipo_appalto,COUNT(*) as conteggio FROM bandi WHERE tipo_appalto IS NOT NULL GROUP BY tipo_appalto ORDER BY conteggio DESC").fetchall())
epo = dl(conn.execute("SELECT origine,COUNT(*) as conteggio FROM esiti GROUP BY origine ORDER BY conteggio DESC").fetchall())
save('charts.json', {'esiti_per_giorno':epg,'bandi_per_tipo':bpt,'esiti_per_origine':epo})

# Entity lists
save('aziende.json', {'dati':dl(conn.execute("SELECT * FROM aziende ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM aziende").fetchone()[0],'pagina':1,'pagine':1})
save('stazioni.json', {'dati':dl(conn.execute("SELECT * FROM stazioni_appaltanti ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM stazioni_appaltanti").fetchone()[0],'pagina':1,'pagine':1})
save('bandi.json', {'dati':dl(conn.execute("SELECT * FROM bandi ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM bandi").fetchone()[0],'pagina':1,'pagine':1})
save('esiti.json', {'dati':dl(conn.execute("SELECT * FROM esiti ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM esiti").fetchone()[0],'pagina':1,'pagine':1})
save('utenti.json', {'dati':dl(conn.execute("SELECT id,username,email,nome,cognome,ruolo,stato,ultimo_accesso,created_at FROM utenti ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM utenti").fetchone()[0],'pagina':1,'pagine':1})
save('email-log.json', {'dati':dl(conn.execute("SELECT * FROM email_log ORDER BY created_at DESC").fetchall()),'totale':conn.execute("SELECT COUNT(*) FROM email_log").fetchone()[0],'pagina':1,'pagine':1})

# AI Monitor
siti_m = dict(conn.execute("SELECT COALESCE(SUM(CASE WHEN attivo THEN 1 ELSE 0 END),0) as attivi,COUNT(*) as totali,COALESCE(SUM(CASE WHEN errori_consecutivi>0 THEN 1 ELSE 0 END),0) as con_errori,MAX(ultimo_scraping) as ultimo_scraping FROM ai_siti_monitorati").fetchone())
atti_r = dict(conn.execute("SELECT COUNT(*) as totali,SUM(CASE WHEN NOT processato THEN 1 ELSE 0 END) as da_processare,SUM(CASE WHEN processato AND esito_id IS NOT NULL THEN 1 ELSE 0 END) as convertiti_in_esiti FROM ai_atti_raw").fetchone())
esiti_ai = dict(conn.execute("SELECT SUM(CASE WHEN stato='nuovo' THEN 1 ELSE 0 END) as nuovi,SUM(CASE WHEN stato='in_revisione' THEN 1 ELSE 0 END) as in_revisione,SUM(CASE WHEN stato='pubblicato' THEN 1 ELSE 0 END) as pubblicati,SUM(CASE WHEN origine IN ('ai_albo_pretorio','ai_stazione_appaltante','ai_piattaforma') THEN 1 ELSE 0 END) as totali_ai FROM esiti").fetchone())
cr = conn.execute("SELECT chiave,valore FROM configurazione WHERE chiave LIKE 'ai_%'").fetchall()
save('ai-monitor-status.json', {'siti_monitorati':siti_m,'atti_raw':atti_r,'esiti_ai':esiti_ai,'configurazione':{r['chiave']:r['valore'] for r in cr}})
save('ai-monitor-siti.json', {'dati':dl(conn.execute("SELECT * FROM ai_siti_monitorati ORDER BY nome").fetchall()),'totale':0,'pagina':1,'pagine':1})
save('ai-monitor-atti.json', {'dati':dl(conn.execute("SELECT * FROM ai_atti_raw ORDER BY data_scoperta DESC").fetchall()),'totale':0,'pagina':1,'pagine':1})

# Review queue
rq = dl(conn.execute("SELECT e.*,s.denominazione as stazione_nome FROM esiti e LEFT JOIN stazioni_appaltanti s ON e.stazione_appaltante_id=s.id WHERE e.stato IN ('in_revisione','nuovo') ORDER BY e.ai_confidence DESC,e.created_at DESC LIMIT 100").fetchall())
save('review-queue.json', {'dati':rq,'totale':len(rq)})

# Concorrenti
save('concorrenti.json', {'dati': dl(conn.execute("SELECT * FROM concorrenti ORDER BY bandi_count DESC").fetchall()), 'totale': conn.execute("SELECT COUNT(*) FROM concorrenti").fetchone()[0]})

conn.close()
print('Export completato!')
