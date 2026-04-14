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
  mediumGray: '#94a3b8',
};

async function fetchBandoData(bandoId) {
  const bandoResult = await query(
    `SELECT b.*,
      s.nome AS stazione_nome, s.citta AS stazione_citta,
      s.sito_web AS stazione_sito_web, s.email AS stazione_email, s.telefono AS stazione_tel,
      pi.nome AS piattaforma_nome, pi.url AS piattaforma_url,
      soa.codice AS soa_codice, soa.descrizione AS soa_descrizione,
      tg.nome AS tipologia_nome,
      c.nome AS criterio_nome,
      p.nome AS provincia_nome, p.sigla AS provincia_sigla,
      r.nome AS regione_nome
     FROM bandi b
     LEFT JOIN stazioni s ON b.id_stazione = s.id
     LEFT JOIN piattaforme pi ON b.id_piattaforma = pi.id
     LEFT JOIN soa ON b.id_soa = soa.id
     LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
     LEFT JOIN criteri c ON b.id_criterio = c.id
     LEFT JOIN province p ON s.id_provincia = p.id
     LEFT JOIN regioni r ON p.id_regione = r.id
     WHERE b.id = $1`,
    [bandoId]
  );

  if (bandoResult.rows.length === 0) return null;

  const bando = bandoResult.rows[0];

  // Fetch allegati
  let allegati = [];
  try {
    const allegatiRes = await query(
      `SELECT id, nome_file, categoria, tipo_mime, dimensione, created_at
       FROM allegati_bando WHERE id_bando = $1 ORDER BY created_at ASC`,
      [bandoId]
    );
    allegati = allegatiRes.rows;
  } catch (e) { /* table may not exist */ }

  return { bando, allegati };
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '0,00 €';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function sanitizeFilename(text) {
  if (!text) return 'Report';
  return text
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .substring(0, 50);
}

function getTodayDate() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}-${month}-${year}`;
}

async function generateBandoPDF(data) {
  const { bando, allegati } = data;

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
  doc.font('Comfortaa-Bold').fontSize(22).fillColor(COLORS.orange).text('Scheda Bando', 30, 115);

  // Stato badge
  const isScaduto = bando.data_offerta && new Date(bando.data_offerta) < new Date();
  if (!isScaduto && !bando.annullato) {
    const badgeX = 450;
    const badgeY = 115;
    doc.save();
    doc.roundedRect(badgeX, badgeY, 115, 30, 5).fillAndStroke(COLORS.lightGreen, COLORS.lightGreen);
    doc.restore();
    doc.font('Comfortaa-Bold').fontSize(10).fillColor(COLORS.green).text('APERTO', badgeX, badgeY + 8, {
      width: 115,
      align: 'center',
    });
  }

  // Info table
  const infoStartY = 170;
  const labelWidth = 150;
  const valueWidth = 535 - labelWidth;
  let currentY = infoStartY;
  const rowHeight = 25;

  const importo = bando.importo_so || bando.importo_co || bando.importo_eco || 0;

  const infoRows = [
    { label: 'STAZIONE APPALTANTE', value: (bando.stazione_nome || '').toUpperCase() },
    { label: 'DATA PUBBLICAZIONE', value: formatDate(bando.data_pubblicazione) },
    { label: 'SCADENZA OFFERTA', value: formatDate(bando.data_offerta), isRed: isScaduto },
    { label: 'OGGETTO', value: bando.titolo || '' },
    { label: 'CIG', value: bando.codice_cig || '-' },
    { label: 'CUP', value: bando.codice_cup || '-' },
    { label: 'TIPOLOGIA', value: bando.tipologia_nome || '' },
    { label: 'CRITERIO', value: bando.criterio_nome || '' },
    { label: 'CATEGORIA SOA', value: `${bando.soa_codice || ''} ${bando.soa_descrizione ? '- ' + bando.soa_descrizione.substring(0, 80) : ''}`.trim() },
    { label: 'PROVINCIA / REGIONE', value: `${bando.provincia_nome || ''} / ${bando.regione_nome || ''}` },
    { label: 'IMPORTO', value: formatCurrency(importo), isImporto: true },
    { label: 'PIATTAFORMA', value: bando.piattaforma_nome || '-' },
    { label: 'NOTE', value: bando.note || '-' },
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
    let valueBold = false;
    if (row.isImporto) { valueColor = COLORS.green; valueBold = true; }
    if (row.isRed) { valueColor = COLORS.red; valueBold = true; }

    const fontName = valueBold ? 'Comfortaa-Bold' : 'Comfortaa';
    doc.font(fontName).fontSize(10).fillColor(valueColor).text(row.value, 35 + labelWidth, currentY + 4, {
      width: valueWidth - 10,
      align: 'left',
    });

    currentY += rowHeight;
  });

  // Allegati section
  if (allegati.length > 0) {
    currentY += 20;
    doc.font('Comfortaa-Bold').fontSize(13).fillColor(COLORS.darkText).text('Allegati', 30, currentY);
    currentY += 25;

    allegati.forEach((a, idx) => {
      if (idx % 2 === 1) {
        doc.save();
        doc.rect(30, currentY, 535, 20).fill(COLORS.lightGray);
        doc.restore();
      }
      doc.font('Comfortaa').fontSize(9).fillColor(COLORS.darkText)
        .text(`${idx + 1}. ${a.nome_file}${a.categoria ? ' (' + a.categoria + ')' : ''}`, 35, currentY + 3, { width: 500 });
      currentY += 20;
    });
  }

  // Footer
  const footerY = doc.page.height - 80;
  doc.save();
  doc.rect(30, footerY, 535, 28).stroke(COLORS.borderGray);
  doc.restore();
  doc.font('Comfortaa').fontSize(7).fillColor(COLORS.mediumGray).text(
    'Ai sensi e per gli effetti della Legge 22 Aprile 1941, n. 633, il presente report è di proprietà EDRA SERVIZI SRL.',
    35, footerY + 3, { width: 525 }
  );

  const gdprY = footerY + 35;
  doc.save();
  doc.rect(30, gdprY, 535, 28).stroke(COLORS.borderGray);
  doc.restore();
  doc.font('Comfortaa').fontSize(7).fillColor(COLORS.mediumGray).text(
    'Informativa sintetica GDPR 2016/679 - Titolare Edra Servizi S.r.l., Via Malta 5/9, 16121 Genova (GE). Info: www.easywin.it.',
    35, gdprY + 3, { width: 525 }
  );

  const pageFooterY = doc.page.height - 20;
  doc.font('Comfortaa').fontSize(9).fillColor(COLORS.darkText);
  doc.text('Copyright www.easywin.it', 30, pageFooterY, { width: 150, align: 'left' });
  doc.text('Pagina 1 di 1', 250, pageFooterY, { width: 100, align: 'center' });
  doc.text('info@easywin.it', 420, pageFooterY, { width: 145, align: 'right' });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function generateBandoXLSX(data) {
  const { bando, allegati } = data;
  const importo = bando.importo_so || bando.importo_co || bando.importo_eco || 0;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Scheda Bando');

  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 42;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 14;

  // Title row
  ws.getRow(1).height = 55;
  ws.mergeCells('B1:C1');
  const b1 = ws.getCell('B1');
  b1.value = 'Scheda Bando';
  b1.font = { name: 'Comfortaa', size: 22, bold: true, color: { argb: 'FFFF8C00' } };
  b1.alignment = { horizontal: 'left', vertical: 'center' };

  ws.getCell('D1').value = 'www.easywin.it';
  ws.getCell('D1').font = { name: 'Comfortaa', size: 10 };

  ws.getRow(2).height = 8;

  const infoRows = [
    { label: 'STAZIONE APPALTANTE', value: (bando.stazione_nome || '').toUpperCase() },
    { label: 'DATA PUBBLICAZIONE', value: formatDate(bando.data_pubblicazione) },
    { label: 'SCADENZA OFFERTA', value: formatDate(bando.data_offerta) },
    { label: 'OGGETTO', value: bando.titolo || '' },
    { label: 'CIG', value: bando.codice_cig || '-' },
    { label: 'CUP', value: bando.codice_cup || '-' },
    { label: 'TIPOLOGIA', value: bando.tipologia_nome || '' },
    { label: 'CRITERIO', value: bando.criterio_nome || '' },
    { label: 'CATEGORIA SOA', value: `${bando.soa_codice || ''} ${bando.soa_descrizione ? '- ' + bando.soa_descrizione.substring(0, 80) : ''}`.trim() },
    { label: 'PROVINCIA / REGIONE', value: `${bando.provincia_nome || ''} / ${bando.regione_nome || ''}` },
    { label: 'IMPORTO', value: formatCurrency(importo), isImporto: true },
    { label: 'PIATTAFORMA', value: bando.piattaforma_nome || '-' },
    { label: 'NOTE', value: bando.note || '-' },
  ];

  let rowNum = 3;
  infoRows.forEach((row) => {
    const excelRow = ws.getRow(rowNum);
    excelRow.height = 22;

    const labelCell = excelRow.getCell(2);
    labelCell.value = row.label;
    labelCell.font = { name: 'Comfortaa', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3a4a5c' } };
    labelCell.alignment = { horizontal: 'left', vertical: 'center' };
    labelCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

    ws.mergeCells(`C${rowNum}:F${rowNum}`);
    const valueCell = excelRow.getCell(3);
    valueCell.value = row.value;
    valueCell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
    valueCell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

    if (row.isImporto) {
      valueCell.font = { name: 'Comfortaa', size: 11, bold: true, color: { argb: 'FF22c55e' } };
    } else {
      valueCell.font = { name: 'Comfortaa', size: 10 };
    }

    rowNum++;
  });

  // Allegati section
  if (allegati.length > 0) {
    rowNum += 1;
    ws.mergeCells(`B${rowNum}:F${rowNum}`);
    const allegatoHeader = ws.getCell(`B${rowNum}`);
    allegatoHeader.value = 'Allegati';
    allegatoHeader.font = { name: 'Comfortaa', size: 12, bold: true };
    rowNum++;

    allegati.forEach((a, idx) => {
      const r = ws.getRow(rowNum);
      r.height = 20;
      ws.mergeCells(`B${rowNum}:F${rowNum}`);
      const cell = r.getCell(2);
      cell.value = `${idx + 1}. ${a.nome_file}${a.categoria ? ' (' + a.categoria + ')' : ''}`;
      cell.font = { name: 'Comfortaa', size: 9 };
      rowNum++;
    });
  }

  // Footer
  rowNum += 2;
  ws.mergeCells(`A${rowNum}:F${rowNum}`);
  const copyrightCell = ws.getCell(`A${rowNum}`);
  copyrightCell.value = 'Copyright www.easywin.it — Edra Servizi S.r.l.';
  copyrightCell.font = { name: 'Comfortaa', size: 7, color: { argb: 'FF94a3b8' } };

  return workbook;
}

export default async function bandiExportRoutes(fastify) {
  // GET /api/bandi/:id/export/pdf
  fastify.get('/:id/export/pdf', async (request, reply) => {
    try {
      const { id } = request.params;

      const data = await fetchBandoData(id);
      if (!data) {
        return reply.code(404).send({ error: 'Bando non trovato' });
      }

      const stazioneName = sanitizeFilename(data.bando.stazione_nome);
      const todayDate = getTodayDate();
      const filename = `Bando_${stazioneName}_${todayDate}.pdf`;

      const pdfBuffer = await generateBandoPDF(data);

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', pdfBuffer.length);
      return reply.send(pdfBuffer);
    } catch (error) {
      console.error('Bando PDF export error:', error);
      return reply.code(500).send({ error: 'Failed to generate PDF', detail: error.message });
    }
  });

  // GET /api/bandi/:id/export/xlsx
  fastify.get('/:id/export/xlsx', async (request, reply) => {
    try {
      const { id } = request.params;

      const data = await fetchBandoData(id);
      if (!data) {
        return reply.code(404).send({ error: 'Bando non trovato' });
      }

      const stazioneName = sanitizeFilename(data.bando.stazione_nome);
      const todayDate = getTodayDate();
      const filename = `Bando_${stazioneName}_${todayDate}.xlsx`;

      const workbook = await generateBandoXLSX(data);
      const buffer = await workbook.xlsx.writeBuffer();

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', buffer.length);
      return reply.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Bando XLSX export error:', error);
      return reply.code(500).send({ error: 'Failed to generate XLSX', detail: error.message });
    }
  });
}
