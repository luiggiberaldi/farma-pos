// Barril de re-export: la lógica se dividió en src/utils/dailyClose/.
// Sin cambios de comportamiento; los importadores existentes no se tocan.
export { generateDailyClosePDF } from './dailyClose/generateDailyClosePDF.js';
export { generateDailyCloseLetterPDF } from './dailyClose/generateDailyCloseLetterPDF.js';
