/**
 * Presidia SOAP Client
 *
 * Client per il web service SOAP di Presidia (macsyws.asmx).
 * Replica l'interfaccia IBandiPresidia del vecchio sistema ASP.NET.
 *
 * Endpoint: http://easywin.presidia.it/macsyws.asmx
 * Namespace: http://www.guru4.net/EuroConv
 *
 * Operazioni principali:
 * - RecuperaBandiAttivi(dal, al) -> DataSet con bandi attivi
 * - TrovaBandiPerFiltri(GUID, categorie, province, ...) -> DataSet filtrato
 * - TrovaBandiPerCodice(sequenzaBandi) -> DataSet per codice specifico
 * - InserimentoAnagrafica(GUID, inizio, fine) -> Registrazione cliente
 * - RecuperaListaCategorie() -> Categorie SOA Presidia
 * - RecuperaFontiDati() -> Fonti dati disponibili
 */

import soap from 'soap';

// ============================================================
// CONFIGURAZIONE
// ============================================================

const DEFAULT_ENDPOINT = 'http://easywin.presidia.it/macsyws.asmx';
const NAMESPACE = 'http://www.guru4.net/EuroConv';

/**
 * Crea un client SOAP verso Presidia
 */
async function createSoapClient(endpoint) {
  const url = endpoint || process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT;
  const wsdlUrl = url + '?WSDL';

  const options = {
    wsdl_options: {
      timeout: 30000,
    },
    forceSoap12Headers: false,
    disableCache: true,
  };

  try {
    const client = await soap.createClientAsync(wsdlUrl, options);
    return client;
  } catch (err) {
    // Se il WSDL non e' raggiungibile, proviamo a creare un client senza WSDL
    // usando un approccio diretto con XML
    throw new Error(`Impossibile connettersi a Presidia (${url}): ${err.message}`);
  }
}

// ============================================================
// MAPPATURA SOA: Codici Presidia (CC*) -> Codici EasyWin (AF*/AG*/etc.)
// ============================================================
// Estratta dal vecchio PresidiaImport.cs (100+ mappature)

const SOA_MAPPING = {
  'CC20C': 'AFC004',
  'CC08A': 'ASF001', 'CC08B': 'AFN002', 'CC08C': 'ASN001',
  'CC09A': 'ASG001', 'CC09B': 'AFN001', 'CC09C': 'ASI001', 'CC09D': 'ASG002',
  'CC12A': 'AFF001', 'CC12B': 'AFF002', 'CC12C': 'AFD001', 'CC12D': 'AFD002',
  'CC12E': 'AFE001', 'CC12F': 'AFD003', 'CC12G': 'AFC001', 'CC12H': 'AFC002',
  'CC12I': 'AFC003', 'CC12L': 'AFG001',
  'CC17A': 'AFA001', 'CC17B': 'APC002', 'CC17C': 'AFA002', 'CC17D': 'AFA004',
  'CC17E': 'APC001',
  'CC18A': 'AMB001', 'CC18B': 'AMB002', 'CC18C': 'AFC001',
  'CC80A': 'AIA002', 'CC80B': 'AIA003', 'CC80C': 'AIA004',
  // Mappature pass-through (codici gia' corretti)
  'ASM005': 'ASM005', 'AGA010': 'AGA010', 'AGC001': 'AGC001',
  'AIA001': 'AIA001', 'AIA002': 'AIA002', 'AIA003': 'AIA003', 'AIA004': 'AIA004',
  'AIA005': 'AIA005', 'AIA006': 'AIA006', 'AIA007': 'AIA007', 'AIA008': 'AIA008',
  'AIA009': 'AIA009', 'AIA010': 'AIA010', 'AIA011': 'AIA011', 'AIA012': 'AIA012',
  'AGA001': 'AGA001', 'AGA002': 'AGA002', 'AGA003': 'AGA003', 'AGA004': 'AGA004',
  'AGA005': 'AGA005', 'AGA006': 'AGA006', 'AGA007': 'AGA007', 'AGA008': 'AGA008',
  'AGA009': 'AGA009',
  'AFC001': 'AFC001', 'AFC002': 'AFC002', 'AFC003': 'AFC003', 'AFC004': 'AFC004',
  'AFC005': 'AFC005', 'AFC006': 'AFC006', 'AFC007': 'AFC007', 'AFC008': 'AFC008',
  'AFC009': 'AFC009', 'AFC010': 'AFC010', 'AFC011': 'AFC011', 'AFC012': 'AFC012',
  'AFC013': 'AFC013', 'AFC014': 'AFC014', 'AFC015': 'AFC015', 'AFC016': 'AFC016',
  'AFC017': 'AFC017', 'AFC018': 'AFC018',
  'AFN001': 'AFN001', 'AFN002': 'AFN002',
  'AFF001': 'AFF001', 'AFF002': 'AFF002',
  'AFD001': 'AFD001', 'AFD002': 'AFD002', 'AFD003': 'AFD003',
  'AFE001': 'AFE001',
  'AFG001': 'AFG001',
  'AFA001': 'AFA001', 'AFA002': 'AFA002', 'AFA003': 'AFA003', 'AFA004': 'AFA004',
  'APC001': 'APC001', 'APC002': 'APC002',
  'AMB001': 'AMB001', 'AMB002': 'AMB002',
  'ASF001': 'ASF001',
  'ASN001': 'ASN001',
  'ASG001': 'ASG001', 'ASG002': 'ASG002',
  'ASI001': 'ASI001',
  'ASM001': 'ASM001', 'ASM002': 'ASM002', 'ASM003': 'ASM003', 'ASM004': 'ASM004',
};

/**
 * Mappa un codice SOA Presidia al codice EasyWin
 */
function mapSoaCode(presidiaCode) {
  if (!presidiaCode) return null;
  const code = presidiaCode.trim().toUpperCase();
  return SOA_MAPPING[code] || code; // Ritorna il codice originale se non c'e' mapping
}

// ============================================================
// ESTRAZIONE CIG / CUP
// ============================================================

const VALID_CIG_CHARS = 'ABCDEFGHILMNOPQRSTUVZXYWJ1234567890';

/**
 * Estrae il codice CIG dal titolo del bando
 * Pattern: " CIG:" seguito da 10 caratteri alfanumerici
 */
function extractCIG(titolo) {
  if (!titolo) return { cig: null, titolo };

  let cleanTitle = titolo;
  let cig = null;

  // Rimuovi " CIG:NON SPECIFICATO"
  cleanTitle = cleanTitle.replace(/\s*CIG\s*:\s*NON\s+SPECIFICATO/gi, '');

  // Cerca pattern CIG
  const cigPatterns = [
    /\s*CIG\s*:\s*([A-Z0-9]{10})/i,
    /\s*CIG\s+([A-Z0-9]{10})/i,
    /\bCIG\s*[:\-]?\s*([A-Z0-9]{10})\b/i,
  ];

  for (const pattern of cigPatterns) {
    const match = cleanTitle.match(pattern);
    if (match) {
      const candidate = match[1].toUpperCase();
      if (isValidCIG(candidate)) {
        cig = candidate;
        // Rimuovi il CIG dal titolo
        cleanTitle = cleanTitle.replace(match[0], '').trim();
        break;
      }
    }
  }

  return { cig, titolo: cleanTitle };
}

/**
 * Valida un codice CIG
 * - Deve essere lungo 10 caratteri
 * - Deve contenere solo caratteri validi
 * - Non puo' contenere solo lettere (deve avere almeno un numero)
 */
function isValidCIG(code) {
  if (!code || code.length !== 10) return false;
  const upper = code.toUpperCase();
  for (const ch of upper) {
    if (!VALID_CIG_CHARS.includes(ch)) return false;
  }
  // Non deve essere solo lettere
  if (/^[A-Z]+$/.test(upper)) return false;
  return true;
}

/**
 * Estrae il codice CUP dal titolo del bando
 * Pattern: varianti di " CUP" seguite da 15 caratteri alfanumerici
 */
function extractCUP(titolo) {
  if (!titolo) return { cup: null, titolo };

  let cleanTitle = titolo;
  let cup = null;

  const cupPatterns = [
    /\s*CUP\s*N\.\s*([A-Z0-9]{15})/i,
    /\s*C\.U\.P\.\s*N\.\s*([A-Z0-9]{15})/i,
    /\s*C\.U\.P\.\s*:\s*([A-Z0-9]{15})/i,
    /\s*C\.U\.P\.\s+([A-Z0-9]{15})/i,
    /\s*CUP\s*:\s*([A-Z0-9]{15})/i,
    /\s*CUP\s*-\s*([A-Z0-9]{15})/i,
    /\s*CUP\s*\[\s*([A-Z0-9]{15})/i,
    /\s*CUP\s+([A-Z0-9]{15})/i,
    /\-CUP\s*:\s*([A-Z0-9]{15})/i,
  ];

  for (const pattern of cupPatterns) {
    const match = cleanTitle.match(pattern);
    if (match) {
      const candidate = match[1].toUpperCase();
      if (isValidCUP(candidate)) {
        cup = candidate;
        cleanTitle = cleanTitle.replace(match[0], '').trim();
        break;
      }
    }
  }

  return { cup, titolo: cleanTitle };
}

/**
 * Valida un codice CUP (15 caratteri alfanumerici, non solo lettere)
 */
function isValidCUP(code) {
  if (!code || code.length !== 15) return false;
  const upper = code.toUpperCase();
  for (const ch of upper) {
    if (!VALID_CIG_CHARS.includes(ch)) return false;
  }
  if (/^[A-Z]+$/.test(upper)) return false;
  return true;
}

// ============================================================
// OPERAZIONI SOAP
// ============================================================

/**
 * Classe client Presidia SOAP
 */
class PresidiaClient {
  constructor(endpoint) {
    this.endpoint = endpoint || process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT;
    this.client = null;
  }

  async connect() {
    if (this.client) return this.client;
    this.client = await createSoapClient(this.endpoint);
    return this.client;
  }

  /**
   * RecuperaBandiAttivi - Recupera bandi attivi per un intervallo di date
   * @param {string} dal - Data inizio (formato yyyy-MM-dd)
   * @param {string} al - Data fine (formato yyyy-MM-dd)
   * @returns {Array} Array di bandi
   */
  async recuperaBandiAttivi(dal, al) {
    const client = await this.connect();
    try {
      const [result] = await client.RecuperaBandiAttiviAsync({ dal, al });
      return this._parseDataSet(result, 'RecuperaBandiAttiviResult');
    } catch (err) {
      throw new Error(`RecuperaBandiAttivi failed: ${err.message}`);
    }
  }

  /**
   * TrovaBandiPerFiltri - Ricerca bandi con filtri avanzati
   * @param {Object} params
   * @param {string} params.guid - GUID utente Presidia
   * @param {string} params.categorie - Categorie SOA (comma-separated)
   * @param {string} params.province - Province (comma-separated)
   * @param {string} params.stato - Stato bando
   * @param {number} params.importoMinimo
   * @param {number} params.importoMassimo
   * @param {string} params.oggetto - Testo ricerca
   * @param {string} params.idEnte - ID ente
   * @param {string} params.ente - Nome ente
   * @param {string} params.immissioneDal - Data immissione inizio
   * @param {string} params.immissioneAl - Data immissione fine
   * @param {string} params.scadenzaDal - Data scadenza inizio
   * @param {string} params.scadenzaAl - Data scadenza fine
   * @param {boolean} params.scorporabili - Flag scorporabili
   * @returns {Array} Array di bandi
   */
  async trovaBandiPerFiltri(params) {
    const client = await this.connect();
    try {
      const [result] = await client.TrovaBandiPerFiltriAsync({
        GUID: params.guid || '',
        categorie: params.categorie || '',
        province: params.province || '',
        stato: params.stato || '',
        importoMinimo: params.importoMinimo || 0,
        importoMassimo: params.importoMassimo || 0,
        oggetto: params.oggetto || '',
        idEnte: params.idEnte || '',
        ente: params.ente || '',
        ImmissioneDal: params.immissioneDal || '',
        ImmissioneAl: params.immissioneAl || '',
        ScadenzaDal: params.scadenzaDal || '',
        ScadenzaAl: params.scadenzaAl || '',
        scorporabili: params.scorporabili || false
      });
      return this._parseDataSet(result, 'TrovaBandiPerFiltriResult');
    } catch (err) {
      throw new Error(`TrovaBandiPerFiltri failed: ${err.message}`);
    }
  }

  /**
   * TrovaBandiPerCodice - Cerca bandi per codice specifico
   * @param {string} sequenzaBandi - Codice/i del bando
   * @returns {Array} Array di bandi
   */
  async trovaBandiPerCodice(sequenzaBandi) {
    const client = await this.connect();
    try {
      const [result] = await client.TrovaBandiPerCodiceAsync({ sequenzaBandi });
      return this._parseDataSet(result, 'TrovaBandiPerCodiceResult');
    } catch (err) {
      throw new Error(`TrovaBandiPerCodice failed: ${err.message}`);
    }
  }

  /**
   * RecuperaListaCategorie - Recupera la lista delle categorie SOA da Presidia
   */
  async recuperaListaCategorie() {
    const client = await this.connect();
    try {
      const [result] = await client.RecuperaListaCategorieAsync({});
      return this._parseDataSet(result, 'RecuperaListaCategorieResult');
    } catch (err) {
      throw new Error(`RecuperaListaCategorie failed: ${err.message}`);
    }
  }

  /**
   * RecuperaFontiDati - Recupera le fonti dati disponibili
   */
  async recuperaFontiDati() {
    const client = await this.connect();
    try {
      const [result] = await client.RecuperaFontiDatiAsync({});
      return this._parseDataSet(result, 'RecuperaFontiDatiResult');
    } catch (err) {
      throw new Error(`RecuperaFontiDati failed: ${err.message}`);
    }
  }

  /**
   * RecuperaSistemiAggiudicazione - Recupera i sistemi di aggiudicazione
   */
  async recuperaSistemiAggiudicazione() {
    const client = await this.connect();
    try {
      const [result] = await client.RecuperaSistemiAggiudicazioneAsync({});
      return this._parseDataSet(result, 'RecuperaSistemiAggiudicazioneResult');
    } catch (err) {
      throw new Error(`RecuperaSistemiAggiudicazione failed: ${err.message}`);
    }
  }

  /**
   * InserimentoAnagrafica - Registra un cliente su Presidia
   * @param {string} guid - GUID utente
   * @param {string} inizioContratto - Data inizio contratto
   * @param {string} fineContratto - Data fine contratto
   * @returns {number} ID registrazione
   */
  async inserimentoAnagrafica(guid, inizioContratto, fineContratto) {
    const client = await this.connect();
    try {
      const [result] = await client.InserimentoAnagraficaAsync({
        GUID: guid,
        InizioContratto: inizioContratto,
        FineContratto: fineContratto
      });
      return result;
    } catch (err) {
      throw new Error(`InserimentoAnagrafica failed: ${err.message}`);
    }
  }

  /**
   * EsistenzaCliente - Verifica se un cliente esiste su Presidia
   * @param {string} guid - GUID utente
   * @returns {boolean}
   */
  async esistenzaCliente(guid) {
    const client = await this.connect();
    try {
      const [result] = await client.EsistenzaClienteAsync({ GUID: guid });
      return result?.EsistenzaClienteResult === true || result?.EsistenzaClienteResult === 'true';
    } catch (err) {
      throw new Error(`EsistenzaCliente failed: ${err.message}`);
    }
  }

  /**
   * SospendiCliente - Sospende un cliente su Presidia
   */
  async sospendiCliente(guid) {
    const client = await this.connect();
    try {
      const [result] = await client.SospendiClienteAsync({ GUID: guid });
      return result;
    } catch (err) {
      throw new Error(`SospendiCliente failed: ${err.message}`);
    }
  }

  /**
   * RiabilitaCliente - Riabilita un cliente su Presidia
   */
  async riabilitaCliente(guid) {
    const client = await this.connect();
    try {
      const [result] = await client.RiabilitaClienteAsync({ GUID: guid });
      return result;
    } catch (err) {
      throw new Error(`RiabilitaCliente failed: ${err.message}`);
    }
  }

  // ============================================================
  // GESTIONE EMAIL PRESIDIA
  // ============================================================

  async associazioneEmail(guid, email) {
    const client = await this.connect();
    const [result] = await client.AssociazioneEmailAsync({ GUID: guid, email });
    return result;
  }

  async recuperaEmail(guid) {
    const client = await this.connect();
    const [result] = await client.RecuperaEmailAsync({ GUID: guid });
    return this._parseDataSet(result, 'RecuperaEmailResult');
  }

  async modificaEmail(idEmail, email) {
    const client = await this.connect();
    const [result] = await client.ModificaEmailAsync({ idEmail, email });
    return result;
  }

  async cancellaEmail(idEmail) {
    const client = await this.connect();
    const [result] = await client.CancellaEmailAsync({ idEmail });
    return result;
  }

  // ============================================================
  // GESTIONE ESIGENZE PRESIDIA
  // ============================================================

  async inserimentoEsigenze(guid, categorie, province, importoMinimo, importoMassimo) {
    const client = await this.connect();
    const [result] = await client.InserimentoEsigenzeAsync({
      GUID: guid, categorie, province, importoMinimo, importoMassimo
    });
    return result;
  }

  async recuperaEsigenze(guid) {
    const client = await this.connect();
    const [result] = await client.RecuperaEsigenzeAsync({ GUID: guid });
    return this._parseDataSet(result, 'RecuperaEsigenzeResult');
  }

  async modificaEsigenza(idEsigenza, categorie, province, importoMinimo, importoMassimo) {
    const client = await this.connect();
    const [result] = await client.ModificaEsigenzaAsync({
      idEsigenza, categorie, province, importoMinimo, importoMassimo
    });
    return result;
  }

  async cancellaEsigenza(idEsigenza) {
    const client = await this.connect();
    const [result] = await client.CancellaEsigenzaAsync({ idEsigenza });
    return result;
  }

  // ============================================================
  // PARSER DATASET
  // ============================================================

  /**
   * Parsa un DataSet XML restituito da Presidia in un array di oggetti
   * Il DataSet SOAP di .NET ha la struttura:
   *   <diffgr:diffgram>
   *     <NewDataSet>
   *       <Table>...</Table>
   *       <Table>...</Table>
   *     </NewDataSet>
   *   </diffgr:diffgram>
   */
  _parseDataSet(result, resultKey) {
    if (!result) return [];

    // Naviga nella struttura DataSet
    const ds = result[resultKey] || result;

    // Il DataSet puo' arrivare come XML gia' parsato o come stringa
    if (typeof ds === 'string') {
      // E' una stringa XML, la parsera' il chiamante
      return ds;
    }

    // Struttura tipica: diffgram > NewDataSet > Table (o nome custom)
    const diffgram = ds['diffgr:diffgram'] || ds.diffgram || ds;
    const dataSet = diffgram?.NewDataSet || diffgram?.DocumentElement || diffgram;

    if (!dataSet) return [];

    // Cerca le righe (Table, Table1, Bando, etc.)
    const tables = dataSet.Table || dataSet.Table1 || dataSet.Bando || dataSet.Row || [];

    if (Array.isArray(tables)) return tables;
    return [tables]; // Singolo record
  }
}

// ============================================================
// DOWNLOAD ALLEGATI
// ============================================================

/**
 * Scarica un allegato bando da ricercappalti.it
 * URL pattern: https://www.ricercappalti.it/docs/{codice}.zip
 *
 * @param {string} externalCode - Codice Presidia del bando (Appalto)
 * @param {number} maxRetries - Tentativi massimi (default: 3)
 * @returns {Buffer|null} Il file scaricato o null se non trovato
 */
async function downloadAllegato(externalCode, maxRetries = 3) {
  const url = `https://www.ricercappalti.it/docs/${externalCode}.zip`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'EasyWin/2.0' },
        signal: AbortSignal.timeout(30000) // 30s timeout
      });

      if (!response.ok) {
        if (response.status === 404) return null; // Allegato non disponibile
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Verifica che non sia una pagina di errore
      const text = buffer.toString('utf8', 0, Math.min(200, buffer.length));
      if (text.includes('bandi@presidia.it') || text.includes('<html')) {
        return null; // Pagina di errore, non un file reale
      }

      return buffer;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`Download allegato fallito dopo ${maxRetries} tentativi: ${url} - ${err.message}`);
        return null;
      }
      // Wait before retry
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

// ============================================================
// UTILITY: Normalizza dati bando da Presidia
// ============================================================

/**
 * Normalizza un record bando Presidia in formato EasyWin
 * Gestisce l'estrazione CIG/CUP, mappatura SOA e pulizia dati
 */
function normalizePresidiaBando(raw) {
  // Estrai titolo e pulisci CIG/CUP
  let titolo = raw.Titolo || raw.titolo || raw.Oggetto || '';
  const cigResult = extractCIG(titolo);
  titolo = cigResult.titolo;
  const cupResult = extractCUP(titolo);
  titolo = cupResult.titolo;

  // CIG puo' essere sia nel titolo che in un campo separato
  const codice_cig = cigResult.cig || raw.CIG || raw.Cig || raw.cig || null;
  const codice_cup = cupResult.cup || raw.CUP || raw.Cup || raw.cup || null;

  // Mappa codice SOA
  const soaOriginal = raw.Categoria || raw.categoria || raw.SOA || raw.Soa || null;
  const soaMapped = mapSoaCode(soaOriginal);

  // Scorporamenti (categorie secondarie)
  const scorporamenti = raw.Scorporamenti || raw.scorporamenti || '';
  const soaSecondarie = parseScorporamenti(scorporamenti);

  // Province
  const siglaProv = raw.SiglaProvincia || raw.siglaProvincia || '';
  const altreProvince = raw.AltreProvince || raw.altreProvince || '';
  const province = parseProvince(siglaProv, altreProvince);

  // Importi
  const importoSO = parseImporto(raw.ImportoComplessivo || raw.Importo || raw.importo);
  const importoCO = parseImporto(raw.ImportoOneriSicurezza || raw.importoOneri);

  // Date
  const dataPubblicazione = parsePresidiaDate(raw.DataPubblicazione || raw.dataPubblicazione);
  const dataScadenza = parsePresidiaDate(raw.DataScadenza || raw.dataScadenza || raw.DataOfferta);
  const dataApertura = parsePresidiaDate(raw.DataApertura || raw.dataApertura);
  const dataSopStart = parsePresidiaDate(raw.DataSopralluogoInizio || raw.dataSopStart);
  const dataSopEnd = parsePresidiaDate(raw.DataSopralluogoFine || raw.dataSopEnd);

  // Stazione appaltante
  const stazione = {
    nome: raw.Ente || raw.ente || raw.StazioneAppaltante || '',
    indirizzo: raw.IndirizzoEnte || raw.indirizzo || '',
    citta: raw.CittaEnte || raw.citta || '',
    cap: raw.CapEnte || raw.cap || '',
    provincia: raw.ProvinciaSigla || siglaProv || '',
    id_presidia: raw.IDEnte || raw.idEnte || null,
  };

  // Fonte dati / piattaforma
  const fonteDati = raw.FonteDati || raw.fonteDati || '';
  let idPiattaforma = null;
  if (fonteDati.toUpperCase().includes('SINTEL')) idPiattaforma = 'SINTEL';
  else if (fonteDati.toUpperCase().includes('MEPA')) idPiattaforma = 'MEPA';

  return {
    external_code: raw.Appalto || raw.appalto || raw.Codice || raw.codice || raw.ID,
    titolo: titolo.trim(),
    codice_cig,
    codice_cup,
    soa_codice: soaMapped,
    soa_originale: soaOriginal,
    soa_secondarie: soaSecondarie,
    province,
    stazione,
    importo_so: importoSO,
    importo_co: importoCO,
    data_pubblicazione: dataPubblicazione,
    data_offerta: dataScadenza,
    data_apertura: dataApertura,
    data_sop_start: dataSopStart,
    data_sop_end: dataSopEnd,
    fonte_dati: fonteDati,
    id_piattaforma: idPiattaforma,
    provenienza: 'Presidia',
    nota_originale: raw.Note || raw.note || '',
    // Flag
    categoria_presunta: raw.CategoriaPresunta === 'Y' || raw.categoriaPresunta === true,
    categoria_alternativa: raw.CategoriaAlternativa === 'Y' || raw.categoriaAlternativa === true,
    // Dati raw per debug
    _raw: raw
  };
}

/**
 * Parse scorporamenti (categorie SOA secondarie) da stringa Presidia
 * Formato: "CC12A|Y|N,CC08B|N|N,..." dove Y/N indica Presunta/Alternativa
 */
function parseScorporamenti(str) {
  if (!str) return [];
  return str.split(',').filter(s => s.trim()).map(s => {
    const parts = s.trim().split('|');
    const code = parts[0];
    const mapped = mapSoaCode(code);
    return {
      codice_originale: code,
      codice_mappato: mapped,
      presunta: parts[1] === 'Y',
      alternativa: parts[2] === 'Y',
      tipo: (parts[1] === 'Y' || parts[2] === 'Y') ? 'alternativa' : 'secondaria'
    };
  });
}

/**
 * Parse province da sigle Presidia
 * Formato: "BA" per singola, "BA,TA,LE" per multiple
 */
function parseProvince(sigla, altre) {
  const all = new Set();
  if (sigla) sigla.split(',').forEach(s => { if (s.trim()) all.add(s.trim().toUpperCase()); });
  if (altre) altre.split(',').forEach(s => { if (s.trim()) all.add(s.trim().toUpperCase()); });
  return [...all];
}

function parsePresidiaDate(str) {
  if (!str) return null;
  // Presidia usa formato "yyyy-MM-dd" o "dd/MM/yyyy"
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Prova formato italiano dd/MM/yyyy
  const parts = str.split('/');
  if (parts.length === 3) {
    const d2 = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return null;
}

function parseImporto(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[^\d.,\-]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// ============================================================
// EXPORTS
// ============================================================

export {
  PresidiaClient,
  normalizePresidiaBando,
  downloadAllegato,
  extractCIG,
  extractCUP,
  isValidCIG,
  isValidCUP,
  mapSoaCode,
  SOA_MAPPING,
  parseScorporamenti,
  DEFAULT_ENDPOINT
};

export default PresidiaClient;
