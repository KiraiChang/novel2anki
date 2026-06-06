/**
 * 清理從 PDF/EPUB 提取的文字，標準化空白與特殊字元。
 * 保留標點符號，因為 compromise 分詞需要它。
 */
export function cleanText(text: string): string {
  return text
    // 連字符換行（word-\nword → word）
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // 各種引號標準化為 ASCII
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // 省略號
    .replace(/…/g, '...')
    // 長破折號
    .replace(/[–—]/g, ' - ')
    // 控制字元（換頁、垂直定位等，保留 \n \t）
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    // 多重空白合為一個
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}
