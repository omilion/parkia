import ExcelJS from "exceljs";
import type { Response } from "express";

export type XlsxCellValue = string | number | boolean | Date | null | undefined;

export type XlsxColumn<T> = {
  header: string;
  width?: number;
  numFmt?: string;
  value: (row: T) => XlsxCellValue;
};

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0F172A" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Datos";
}

function asFileName(value: string) {
  return value.endsWith(".xlsx") ? value : `${value}.xlsx`;
}

export async function sendXlsxTable<T>(
  res: Response,
  input: {
    filename: string;
    sheetName: string;
    columns: XlsxColumn<T>[];
    rows: T[];
  },
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Parkia";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(safeSheetName(input.sheetName), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = input.columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width || Math.min(Math.max(column.header.length + 4, 14), 36),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  });

  for (const row of input.rows) {
    sheet.addRow(input.columns.map((column) => column.value(row) ?? ""));
  }

  input.columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    if (column.numFmt) excelColumn.numFmt = column.numFmt;
    excelColumn.alignment = { vertical: "top", wrapText: true };
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: input.columns.length },
  };

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${asFileName(input.filename)}"`);
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}
