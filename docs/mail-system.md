# Mail System — EasyWin

Documentazione master:
- Architettura: [DESIGN_MAIL_SYSTEM.md](../DESIGN_MAIL_SYSTEM.md)
- Analisi legacy: [RECON_MAIL_SYSTEM.md](../RECON_MAIL_SYSTEM.md)
- Config env: vedi `backend/.env.example` sezione MAIL SYSTEM

## Quick reference

- Single entry point: `backend/src/lib/mail-transport.js` → `send()`
- Log unificato: tabella `mail_log`
- Provider: Brevo (prerequisiti DNS SPF/DKIM/DMARC, vedi §8 del design)
- Rate-limit: 20 msg/sec, prudente (Brevo regge di più)
- Canali: enum documentato in DESIGN_MAIL_SYSTEM.md §3.2
