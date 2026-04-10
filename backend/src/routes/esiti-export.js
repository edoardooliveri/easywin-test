import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COLORS = {
  orange: '#FF8C00',
  green: '#22c55e',
  lightGreen: '#dcfce7',
  darkBg: '#3a4a5c',
  lightGray: '#f8fafc',
  borderGray: '#e2e8f0',
  darkText: '#1e293b',
  red: '#ef4444',
  yellow: '#fef3c7',
  mediumGray: '#94a3b8',
};

// Fetch esito data from database
async function fetchEsitoData(esitoId) {
  const esitoQuery = `
    SELECT
      g."id",
      g."data" AS data_gara,
      g."importo",
      g."n_partecipanti" AS n_concorrenti,
      g."media_ar",
      g."media_sc",
      g."soglia_an",
      g."ribasso",
      g."note",
      g."annullato",
      g."id_soa",
      g."variante",
      COALESCE(b."titolo", g."titolo") AS titolo,
      COALESCE(b."codice_cig", g."codice_cig") AS codice_cig,
      b."id_stazione",
      s."nome" AS stazione_nome,
      soa."codice" AS soa_codice,
      soa."descrizione" AS soa_descrizione,
      tg."nome" AS tipologia_nome,
      cr."nome" AS criterio_nome,
      p."nome" AS provincia_nome,
      r."nome" AS regione_nome,
      az."ragione_sociale" AS vincitore_nome
    FROM gare g
    LEFT JOIN bandi b ON g."id_bando" = b."id"
    LEFT JOIN stazioni s ON b."id_stazione" = s."id"
    LEFT JOIN province p ON s."id_provincia" = p."id"
    LEFT JOIN regioni r ON p."id_regione" = r."id"
    LEFT JOIN soa ON g."id_soa" = soa."id"
    LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
    LEFT JOIN criteri cr ON b."id_criterio" = cr."id"
    LEFT JOIN aziende az ON g."id_vincitore" = az."id"
    WHERE g.id = $1
  `;

  const esitoResult = await query(esitoQuery, [esitoId]);
  if (esitoResult.rows.length === 0) {
    return null;
  }

  const esito = esitoResult.rows[0];

  // Fetch graduatoria (participants) from dettaglio_gara
  const graduatoriaQuery = `
    SELECT
      dg."posizione",
      dg."ribasso",
      dg."vincitrice",
      dg."ammessa",
      dg."ammessa_riserva",
      dg."taglio_ali",
      dg."anomala",
      dg."esclusa",
      dg."note",
      dg."m_media_arit" AS sotto_media,
      COALESCE(az."ragione_sociale", dg."ragione_sociale") AS ragione_sociale,
      p."nome" AS provincia_nome
    FROM dettaglio_gara dg
    LEFT JOIN aziende az ON dg."id_azienda" = az."id"
    LEFT JOIN province p ON az."id_provincia" = p."id"
    WHERE dg."id_gara" = $1
    ORDER BY dg."posizione" ASC NULLS LAST
  `;

  const graduatoriaResult = await query(graduatoriaQuery, [esitoId]);

  return {
    esito,
    graduatoria: graduatoriaResult.rows,
  };
}

// Format date as dd/mm/yyyy
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Format currency in Italian style
function formatCurrency(value) {
  if (value === null || value === undefined) return '0,00 €';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Format percentage with comma
function formatPercentage(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toFixed(3).replace('.', ',') + '%';
}

// Sanitize filename
function sanitizeFilename(text) {
  if (!text) return 'Report';
  return text
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .substring(0, 50);
}

// Get today's date as dd-mm-yyyy
function getTodayDate() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}-${month}-${year}`;
}

// Get vincitrice from graduatoria
function getVincitrice(graduatoria) {
  return graduatoria.find((p) => p.vincitrice);
}

// Get excluded companies
function getEsclusi(graduatoria) {
  return graduatoria.filter((p) => p.esclusa);
}

// Generate PDF
async function generatePDF(data) {
  const { esito, graduatoria } = data;
  const vincitrice = getVincitrice(graduatoria);
  const esclusi = getEsclusi(graduatoria);

  const doc = new PDFDocument({
    bufferPages: true,
    margin: 30,
    size: 'A4',
  });

  const regularFontPath = path.resolve(__dirname, '../../assets/fonts/Comfortaa-Regular.ttf');
  const boldFontPath = path.resolve(__dirname, '../../assets/fonts/Comfortaa-Bold.ttf');

  doc.registerFont('Comfortaa', regularFontPath);
  doc.registerFont('Comfortaa-Bold', boldFontPath);

  const logoPath = path.resolve(__dirname, '../../../logo.png');

  // Header
  doc.image(logoPath, 30, 30, { width: 60 });
  doc.font('Comfortaa').fontSize(10).text('www.easywin.it', 30, 95, { align: 'center', width: 535 });

  // Title
  doc.font('Comfortaa-Bold').fontSize(22).fillColor(COLORS.orange).text('Report di Gara', 30, 115);

  // Aggiudicato badge
  if (vincitrice) {
    const badgeX = 450;
    const badgeY = 115;
    const badgeWidth = 115;
    const badgeHeight = 30;
    doc.save();
    doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 5).fillAndStroke(COLORS.lightGreen, COLORS.lightGreen);
    doc.restore();
    doc.font('Comfortaa-Bold').fontSize(10).fillColor(COLORS.green).text('AGGIUDICATO', badgeX, badgeY + 8, {
      width: badgeWidth,
      align: 'center',
    });
  }

  // Info table
  const infoStartY = 170;
  const labelWidth = 140;
  const valueWidth = 535 - labelWidth;
  let currentY = infoStartY;
  const rowHeight = 25;

  const infoRows = [
    { label: 'STAZIONE APPALTANTE', value: (esito.stazione_nome || '').toUpperCase() },
    { label: 'DATA', value: formatDate(esito.data_gara) },
    { label: 'OGGETTO', value: `${esito.titolo} - CIG: ${esito.codice_cig}` },
    { label: 'TIPOLOGIA', value: esito.tipologia_nome || '' },
    { label: 'CATEGORIA PREVALENTE', value: `${esito.soa_codice || ''} - ${(esito.soa_descrizione || '').substring(0, 80)}` },
    { label: 'PROVINCIA / REGIONE', value: `${esito.provincia_nome || ''} / ${esito.regione_nome || ''}` },
    { label: 'IMPORTO', value: formatCurrency(esito.importo), isImporto: true },
    { label: 'PARTECIPANTI', value: `${esito.n_concorrenti || graduatoria.length} di cui ammessi ${graduatoria.filter(g => g.ammessa).length}`, bold: true },
    { label: 'MEDIA ARITMETICA', value: formatPercentage(esito.media_ar) },
    { label: 'MEDIA SCARTI', value: formatPercentage(esito.media_sc) },
    { label: 'SOGLIA ANOMALIA', value: formatPercentage(esito.soglia_an) },
    { label: 'VINCITRICE', value: vincitrice ? vincitrice.ragione_sociale : '-', isVincitrice: true },
    { label: 'RIBASSO', value: vincitrice ? formatPercentage(vincitrice.ribasso) : '-', isRibasso: true },
    { label: 'NOTE', value: esito.note || '-' },
  ];

  infoRows.forEach((row) => {
    // Label cell
    doc.save();
    doc.rect(30, currentY, labelWidth, rowHeight).fill(COLORS.darkBg);
    doc.restore();

    doc.font('Comfortaa-Bold').fontSize(9).fillColor('white').text(row.label, 35, currentY + 4, {
      width: labelWidth - 10,
      align: 'left',
    });

    // Value cell
    doc.save();
    doc.rect(30 + labelWidth, currentY, valueWidth, rowHeight).stroke(COLORS.borderGray);
    doc.restore();

    let valueColor = COLORS.darkText;
    let valueFontSize = 10;
    let valueBold = false;

    if (row.isImporto) {
      valueColor = COLORS.green;
      valueBold = true;
      valueFontSize = 11;
    } else if (row.isVincitrice) {
      valueColor = COLORS.red;
      valueBold = true;
    } else if (row.isRibasso) {
      valueColor = COLORS.orange;
      valueBold = true;
    } else if (row.bold) {
      valueBold = true;
    }

    const fontName = valueBold ? 'Comfortaa-Bold' : 'Comfortaa';
    doc.font(fontName).fontSize(valueFontSize).fillColor(valueColor).text(row.value, 35 + labelWidth, currentY + 4, {
      width: valueWidth - 10,
      align: 'left',
    });

    currentY += rowHeight;
  });

  // Graduatoria section
  currentY += 20;
  doc.font('Comfortaa-Bold').fontSize(13).fillColor(COLORS.darkText).text('Classifica Partecipanti', 30, currentY);

  currentY += 25;
  const tableStartY = currentY;
  const colWidths = { pos: 30, azienda: 180, provincia: 100, ribasso: 80, risultato: 85, scarto: 60 };
  const tableX = 30;

  // Header row
  doc.save();
  doc.rect(tableX, currentY, 535, 25).fill(COLORS.darkBg);
  doc.restore();

  const headers = ['#', 'AZIENDA', 'PROVINCIA', 'RIBASSO', 'RISULTATO', 'SCARTO'];
  let headerX = tableX;
  doc.font('Comfortaa-Bold').fontSize(8.5).fillColor('white');

  doc.text('#', headerX, currentY + 6, { width: colWidths.pos, align: 'center' });
  headerX += colWidths.pos;
  doc.text('AZIENDA', headerX, currentY + 6, { width: colWidths.azienda, align: 'center' });
  headerX += colWidths.azienda;
  doc.text('PROVINCIA', headerX, currentY + 6, { width: colWidths.provincia, align: 'center' });
  headerX += colWidths.provincia;
  doc.text('RIBASSO', headerX, currentY + 6, { width: colWidths.ribasso, align: 'center' });
  headerX += colWidths.ribasso;
  doc.text('RISULTATO', headerX, currentY + 6, { width: colWidths.risultato, align: 'center' });
  headerX += colWidths.risultato;
  doc.text('SCARTO', headerX, currentY + 6, { width: colWidths.scarto, align: 'center' });

  currentY += 25;

  // Data rows
  let rowBg = 'white';
  graduatoria.forEach((row, idx) => {
    const isVincitrice = row.vincitrice;
    const isEsclusa = row.esclusa;

    if (isVincitrice) {
      doc.save();
      doc.rect(tableX, currentY, 535, 22).fill(COLORS.yellow);
      doc.restore();
    } else if (idx % 2 === 1) {
      doc.save();
      doc.rect(tableX, currentY, 535, 22).fill(COLORS.lightGray);
      doc.restore();
    }

    // Draw borders
    doc.save();
    doc.rect(tableX, currentY, 535, 22).stroke(COLORS.borderGray);
    doc.restore();

    const textColor = isVincitrice ? COLORS.orange : COLORS.darkText;
    let dataX = tableX;

    doc.font('Comfortaa').fontSize(9).fillColor(textColor);
    doc.text(String(row.posizione || idx + 1), dataX, currentY + 4, { width: colWidths.pos, align: 'center' });
    dataX += colWidths.pos;

    doc.font('Comfortaa').fontSize(9).fillColor(textColor).text(row.ragione_sociale || '', dataX, currentY + 4, {
      width: colWidths.azienda,
      align: 'left',
    });
    dataX += colWidths.azienda;

    doc.text(row.provincia_nome || '', dataX, currentY + 4, { width: colWidths.provincia, align: 'left' });
    dataX += colWidths.provincia;

    doc.fillColor(COLORS.orange).text(formatPercentage(row.ribasso), dataX, currentY + 4, {
      width: colWidths.ribasso,
      align: 'center',
    });
    dataX += colWidths.ribasso;

    let risultato = '';
    if (isVincitrice) {
      risultato = 'Vincitrice';
      doc.fillColor(COLORS.green);
    } else if (row.ammessa) {
      risultato = 'Ammessa';
      doc.fillColor(COLORS.darkText);
    } else if (isEsclusa) {
      risultato = 'Esclusa';
      doc.fillColor(COLORS.red);
    } else {
      risultato = 'Non ammessa';
      doc.fillColor(COLORS.darkText);
    }

    doc.text(risultato, dataX, currentY + 4, { width: colWidths.risultato, align: 'center' });
    dataX += colWidths.risultato;

    doc.fillColor(COLORS.darkText).text(formatPercentage(row.sotto_media), dataX, currentY + 4, {
      width: colWidths.scarto,
      align: 'center',
    });

    currentY += 22;
  });

  // Esclusi section
  currentY += 15;
  if (esclusi.length === 0) {
    doc.font('Comfortaa').fontSize(9).fillColor(COLORS.mediumGray)
      .text('Nessuna azienda esclusa dalla gara', 30, currentY);
  } else {
    doc.font('Comfortaa-Bold').fontSize(10).fillColor(COLORS.darkText).text('Aziende escluse:', 30, currentY);
    currentY += 18;
    esclusi.forEach((azienda) => {
      doc.font('Comfortaa').fontSize(9).text(`• ${azienda.ragione_sociale}`, 40, currentY);
      currentY += 15;
    });
  }

  // Footer
  const footerY = doc.page.height - 80;

  // Copyright box
  doc.save();
  doc.rect(30, footerY, 535, 28).stroke(COLORS.borderGray);
  doc.restore();

  doc.font('Comfortaa').fontSize(7).fillColor(COLORS.mediumGray).text(
    'Ai sensi e per gli effetti della Legge 22 Aprile 1941, n. 633, il presente report è di proprietà EDRA SERVIZI SRL. E\' severamente vietata la riproduzione, la ridistribuzione, la rielaborazione in toto o in parte con qualsiasi mezzo e forma.',
    35,
    footerY + 3,
    { width: 525 }
  );

  // GDPR box
  const gdprY = footerY + 35;
  doc.save();
  doc.rect(30, gdprY, 535, 28).stroke(COLORS.borderGray);
  doc.restore();

  doc.font('Comfortaa').fontSize(7).fillColor(COLORS.mediumGray).text(
    'Informativa sintetica GDPR 2016/679 - Vi informiamo che i Vs. dati saranno trattati con strumenti manuali e/o telematici dal Titolare Edra Servizi S.r.l., con sede in Via Malta 5/9, 16121 Genova (GE). L\'informativa completa è a disposizione sul nostro sito: www.easywin.it.',
    35,
    gdprY + 3,
    { width: 525 }
  );

  // Page footer
  const pageFooterY = doc.page.height - 20;
  doc.font('Comfortaa').fontSize(9).fillColor(COLORS.darkText);
  doc.text('Copyright www.easywin.it', 30, pageFooterY, { width: 150, align: 'left' });
  doc.text('Pagina 1 di 1', 250, pageFooterY, { width: 100, align: 'center' });
  doc.text('info@easywin.it', 420, pageFooterY, { width: 145, align: 'right' });

  // Collect PDF into buffer
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Generate XLSX
async function generateXLSX(data) {
  const { esito, graduatoria } = data;
  const vincitrice = getVincitrice(graduatoria);
  const esclusi = getEsclusi(graduatoria);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report di Gara');

  // Set column widths
  worksheet.getColumn(1).width = 5;
  worksheet.getColumn(2).width = 22;
  worksheet.getColumn(3).width = 38;
  worksheet.getColumn(4).width = 16;
  worksheet.getColumn(5).width = 14;
  worksheet.getColumn(6).width = 14;
  worksheet.getColumn(7).width = 12;

  const comfortaaFont = { name: 'Comfortaa', size: 9 };
  const comfortaaBoldFont = { name: 'Comfortaa', size: 9, bold: true };

  // Row 1: Header
  worksheet.getRow(1).height = 55;
  worksheet.mergeCells('B1:C1');
  const b1 = worksheet.getCell('B1');
  b1.value = 'Report di Gara';
  b1.font = { name: 'Comfortaa', size: 22, bold: true, color: { argb: 'FFFF8C00' } };
  b1.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };

  const d1 = worksheet.getCell('D1');
  d1.value = 'www.easywin.it';
  d1.font = { name: 'Comfortaa', size: 10 };
  d1.alignment = { horizontal: 'left', vertical: 'top' };

  if (vincitrice) {
    worksheet.mergeCells('E1:F1');
    const ef1 = worksheet.getCell('E1');
    ef1.value = 'AGGIUDICATO';
    ef1.font = { name: 'Comfortaa', size: 9, bold: true, color: { argb: 'FF22c55e' } };
    ef1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdcfce7' } };
    ef1.alignment = { horizontal: 'center', vertical: 'center' };
  }

  // Row 2: Spacer
  worksheet.getRow(2).height = 8;

  // Info rows (3-17)
  const infoRows = [
    { label: 'STAZIONE APPALTANTE', value: (esito.stazione_nome || '').toUpperCase() },
    { label: 'DATA', value: formatDate(esito.data_gara) },
    { label: 'OGGETTO', value: `${esito.titolo} - CIG: ${esito.codice_cig}`, rowHeight: 28 },
    { label: 'TIPOLOGIA', value: esito.tipologia_nome || '', rowHeight: 28 },
    { label: 'CATEGORIA PREVALENTE', value: `${esito.soa_codice || ''} - ${(esito.soa_descrizione || '').substring(0, 80)}` },
    { label: 'PROVINCIA / REGIONE', value: `${esito.provincia_nome || ''} / ${esito.regione_nome || ''}` },
    { label: 'IMPORTO', value: formatCurrency(esito.importo), isImporto: true },
    { label: 'PARTECIPANTI', value: `${esito.n_concorrenti || graduatoria.length} di cui ammessi ${graduatoria.filter(g => g.ammessa).length}`, bold: true },
    { label: 'MEDIA ARITMETICA', value: formatPercentage(esito.media_ar) },
    { label: 'MEDIA SCARTI', value: formatPercentage(esito.media_sc) },
    { label: 'SOGLIA ANOMALIA', value: formatPercentage(esito.soglia_an) },
    { label: 'VINCITRICE', value: vincitrice ? vincitrice.ragione_sociale : '-', isVincitrice: true },
    { label: 'RIBASSO', value: vincitrice ? formatPercentage(vincitrice.ribasso) : '-', isRibasso: true },
    { label: 'NOTE', value: esito.note || '-' },
  ];

  let rowNum = 3;
  infoRows.forEach((row) => {
    const excelRow = worksheet.getRow(rowNum);
    excelRow.height = row.rowHeight || 22;

    const labelCell = excelRow.getCell(2);
    labelCell.value = row.label;
    labelCell.font = { name: 'Comfortaa', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3a4a5c' } };
    labelCell.alignment = { horizontal: 'left', vertical: 'center' };
    labelCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } }, left: { style: 'thin', color: { argb: 'FFe2e8f0' } }, right: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

    worksheet.mergeCells(`C${rowNum}:F${rowNum}`);
    const valueCell = excelRow.getCell(3);
    valueCell.value = row.value;
    valueCell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
    valueCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } }, left: { style: 'thin', color: { argb: 'FFe2e8f0' } }, right: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

    if (row.isImporto) {
      valueCell.font = { name: 'Comfortaa', size: 11, bold: true, color: { argb: 'FF22c55e' } };
    } else if (row.isVincitrice) {
      valueCell.font = { name: 'Comfortaa', size: 10, bold: true, color: { argb: 'FFef4444' } };
    } else if (row.isRibasso) {
      valueCell.font = { name: 'Comfortaa', size: 10, bold: true, color: { argb: 'FFFF8C00' } };
    } else if (row.bold) {
      valueCell.font = { name: 'Comfortaa', size: 10, bold: true };
    } else {
      valueCell.font = { name: 'Comfortaa', size: 10 };
    }

    rowNum++;
  });

  // Row 19: Spacer
  worksheet.getRow(19).height = 8;

  // Row 20: Classifica header
  worksheet.getRow(20).height = 28;
  worksheet.mergeCells('B20:F20');
  const classifyCell = worksheet.getCell('B20');
  classifyCell.value = 'Classifica Partecipanti';
  classifyCell.font = { name: 'Comfortaa', size: 12, bold: true };
  classifyCell.alignment = { horizontal: 'left', vertical: 'center' };

  // Row 21: Table header
  worksheet.getRow(21).height = 24;
  const headers = [
    { col: 'A', val: '#' },
    { col: 'B', val: 'AZIENDA' },
    { col: 'C', val: 'PROVINCIA' },
    { col: 'D', val: 'RIBASSO' },
    { col: 'E', val: 'RISULTATO' },
    { col: 'F', val: 'SCARTO' },
  ];

  headers.forEach(({ col, val }) => {
    const cell = worksheet.getCell(`${col}21`);
    cell.value = val;
    cell.font = { name: 'Comfortaa', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3a4a5c' } };
    cell.alignment = { horizontal: 'center', vertical: 'center' };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  // Data rows
  let dataRowNum = 22;
  graduatoria.forEach((row, idx) => {
    const isVincitrice = row.vincitrice;
    const excelRow = worksheet.getRow(dataRowNum);
    excelRow.height = 22;

    // Position
    const posCell = excelRow.getCell(1);
    posCell.value = row.posizione || idx + 1;
    posCell.font = { name: 'Comfortaa', size: 9 };
    posCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    posCell.alignment = { horizontal: 'center', vertical: 'center' };

    // Azienda
    const aziendaCell = excelRow.getCell(2);
    aziendaCell.value = row.ragione_sociale || '';
    aziendaCell.font = { name: 'Comfortaa', size: 9, bold: true, color: { argb: isVincitrice ? 'FFFF8C00' : 'FF1E2D3D' } };
    aziendaCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    aziendaCell.alignment = { horizontal: 'left', vertical: 'center' };

    if (isVincitrice) {
      aziendaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } };
    } else if (idx % 2 === 1) {
      aziendaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
    }

    // Provincia
    const provinciaCell = excelRow.getCell(3);
    provinciaCell.value = row.provincia_nome || '';
    provinciaCell.font = { name: 'Comfortaa', size: 9, color: { argb: isVincitrice ? 'FFFF8C00' : 'FF1e293b' } };
    provinciaCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    provinciaCell.alignment = { horizontal: 'left', vertical: 'center' };

    if (isVincitrice) {
      provinciaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } };
    } else if (idx % 2 === 1) {
      provinciaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
    }

    // Ribasso
    const ribassoCell = excelRow.getCell(4);
    ribassoCell.value = formatPercentage(row.ribasso);
    ribassoCell.font = { name: 'Comfortaa', size: 9, color: { argb: 'FFFF8C00' } };
    ribassoCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    ribassoCell.alignment = { horizontal: 'center', vertical: 'center' };

    if (isVincitrice) {
      ribassoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } };
    } else if (idx % 2 === 1) {
      ribassoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
    }

    // Risultato
    const risultatoCell = excelRow.getCell(5);
    let risultato = '';
    let risultatoColor = 'FF1e293b';

    if (isVincitrice) {
      risultato = 'Vincitrice';
      risultatoColor = 'FF22c55e';
    } else if (row.ammessa) {
      risultato = 'Ammessa';
    } else if (row.esclusa) {
      risultato = 'Esclusa';
      risultatoColor = 'FFef4444';
    } else {
      risultato = 'Non ammessa';
    }

    risultatoCell.value = risultato;
    risultatoCell.font = { name: 'Comfortaa', size: 9, color: { argb: risultatoColor } };
    risultatoCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    risultatoCell.alignment = { horizontal: 'center', vertical: 'center' };

    if (isVincitrice) {
      risultatoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } };
    } else if (idx % 2 === 1) {
      risultatoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
    }

    // Scarto
    const scartoCell = excelRow.getCell(6);
    scartoCell.value = formatPercentage(row.sotto_media);
    scartoCell.font = { name: 'Comfortaa', size: 9, color: { argb: isVincitrice ? 'FFFF8C00' : 'FF1e293b' } };
    scartoCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    scartoCell.alignment = { horizontal: 'center', vertical: 'center' };

    if (isVincitrice) {
      scartoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } };
    } else if (idx % 2 === 1) {
      scartoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
    }

    dataRowNum++;
  });

  // Esclusi section
  dataRowNum++; // Skip one row
  const esclusiRowNum = dataRowNum;

  worksheet.getRow(esclusiRowNum).height = 20;
  worksheet.mergeCells(`A${esclusiRowNum}:F${esclusiRowNum}`);
  const esclusiCell = worksheet.getCell(`A${esclusiRowNum}`);

  if (esclusi.length === 0) {
    esclusiCell.value = 'Nessuna azienda esclusa dalla gara';
  } else {
    esclusiCell.value = esclusi.map((a) => a.ragione_sociale).join(', ');
  }

  esclusiCell.font = { name: 'Comfortaa', size: 9, italic: true, color: { argb: 'FF94a3b8' } };
  esclusiCell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };

  // Copyright and GDPR
  const copyrightRowNum = esclusiRowNum + 2;
  worksheet.getRow(copyrightRowNum).height = 18;
  worksheet.mergeCells(`A${copyrightRowNum}:F${copyrightRowNum}`);
  const copyrightCell = worksheet.getCell(`A${copyrightRowNum}`);
  copyrightCell.value = 'Ai sensi e per gli effetti della Legge 22 Aprile 1941, n. 633, il presente report è di proprietà EDRA SERVIZI SRL. E\' severamente vietata la riproduzione, la ridistribuzione, la rielaborazione in toto o in parte con qualsiasi mezzo e forma.';
  copyrightCell.font = { name: 'Comfortaa', size: 7, color: { argb: 'FF94a3b8' } };
  copyrightCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  copyrightCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

  const gdprRowNum = copyrightRowNum + 1;
  worksheet.getRow(gdprRowNum).height = 18;
  worksheet.mergeCells(`A${gdprRowNum}:F${gdprRowNum}`);
  const gdprCell = worksheet.getCell(`A${gdprRowNum}`);
  gdprCell.value = 'Informativa sintetica GDPR 2016/679 - Vi informiamo che i Vs. dati saranno trattati con strumenti manuali e/o telematici dal Titolare Edra Servizi S.r.l., con sede in Via Malta 5/9, 16121 Genova (GE). L\'informativa completa è a disposizione sul nostro sito: www.easywin.it.';
  gdprCell.font = { name: 'Comfortaa', size: 7, color: { argb: 'FF94a3b8' } };
  gdprCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  gdprCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

  // Footer
  const footerRowNum = gdprRowNum + 2;
  worksheet.getRow(footerRowNum).height = 18;

  const footerLeftCell = worksheet.getCell(`A${footerRowNum}`);
  worksheet.mergeCells(`A${footerRowNum}:B${footerRowNum}`);
  footerLeftCell.value = 'Copyright www.easywin.it';
  footerLeftCell.font = { name: 'Comfortaa', size: 9 };
  footerLeftCell.alignment = { horizontal: 'left', vertical: 'center' };

  const footerCenterCell = worksheet.getCell(`C${footerRowNum}`);
  worksheet.mergeCells(`C${footerRowNum}:D${footerRowNum}`);
  footerCenterCell.value = 'Pagina 1 di 1';
  footerCenterCell.font = { name: 'Comfortaa', size: 9 };
  footerCenterCell.alignment = { horizontal: 'center', vertical: 'center' };

  const footerRightCell = worksheet.getCell(`E${footerRowNum}`);
  worksheet.mergeCells(`E${footerRowNum}:F${footerRowNum}`);
  footerRightCell.value = 'info@easywin.it';
  footerRightCell.font = { name: 'Comfortaa', size: 9 };
  footerRightCell.alignment = { horizontal: 'right', vertical: 'center' };

  return workbook;
}

export default async function esitiExportRoutes(fastify) {
  // GET /:id/export/pdf
  fastify.get('/:id/export/pdf', async (request, reply) => {
    try {
      const { id } = request.params;

      const data = await fetchEsitoData(id);
      if (!data) {
        return reply.code(404).send({ error: 'Esito not found' });
      }

      const stazioneName = sanitizeFilename(data.esito.stazione_nome);
      const todayDate = getTodayDate();
      const filename = `Esito_${stazioneName}_${todayDate}.pdf`;

      const pdfBuffer = await generatePDF(data);

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', pdfBuffer.length);
      return reply.send(pdfBuffer);
    } catch (error) {
      console.error('PDF export error:', error);
      return reply.code(500).send({ error: 'Failed to generate PDF', detail: error.message, stack: error.stack });
    }
  });

  // GET /:id/export/xlsx
  fastify.get('/:id/export/xlsx', async (request, reply) => {
    try {
      const { id } = request.params;

      const data = await fetchEsitoData(id);
      if (!data) {
        return reply.code(404).send({ error: 'Esito not found' });
      }

      const stazioneName = sanitizeFilename(data.esito.stazione_nome);
      const todayDate = getTodayDate();
      const filename = `Esito_${stazioneName}_${todayDate}.xlsx`;

      const workbook = await generateXLSX(data);
      const buffer = await workbook.xlsx.writeBuffer();

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', buffer.length);
      return reply.send(Buffer.from(buffer));
    } catch (error) {
      console.error('XLSX export error:', error);
      return reply.code(500).send({ error: 'Failed to generate XLSX', detail: error.message });
    }
  });
}
