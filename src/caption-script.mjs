import pinyinPackage from 'pinyin';

const pinyin = pinyinPackage.default || pinyinPackage;
const isContent = char => /[\p{L}\p{N}]/u.test(char);
const isHan = char => {
  const code = char.codePointAt(0);
  return (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff);
};

function reading(char) {
  if (!isHan(char)) return char.toLocaleLowerCase();
  return pinyin(char, {style: pinyin.STYLE_TONE, heteronym: false})?.[0]?.[0] || char;
}

function contentChars(text) {
  return Array.from(String(text || '')).filter(isContent);
}

function scriptSignature(text) {
  return contentChars(text).map(reading).join('|');
}

function takeReferenceSegments(reference, counts) {
  const chars = Array.from(String(reference || ''));
  const result = [];
  let cursor = 0;
  for (const count of counts) {
    if (!count) {
      result.push('');
      continue;
    }
    const start = cursor;
    let taken = 0;
    while (cursor < chars.length && taken < count) {
      if (isContent(chars[cursor])) taken += 1;
      cursor += 1;
    }
    while (cursor < chars.length && !isContent(chars[cursor])) cursor += 1;
    result.push(chars.slice(start, cursor).join('').trim());
  }
  return result;
}

// 仅在整段识别与已确认文案的拼音序列完全一致时校正字形；时间轴和原始识别记录不变。
export function alignRowsToReference(rows, reference) {
  if (!Array.isArray(rows) || !rows.length || typeof reference !== 'string' || !reference.trim()) return rows;
  const detectedText = rows.map(row => row.text || '').join('');
  const detectedChars = contentChars(detectedText);
  const referenceChars = contentChars(reference);
  if (!detectedChars.length || detectedChars.length !== referenceChars.length) return rows;
  if (scriptSignature(detectedText) !== scriptSignature(reference)) return rows;
  const replacements = takeReferenceSegments(reference, rows.map(row => contentChars(row.text).length));
  if (replacements.some((text, index) => !text && contentChars(rows[index].text).length)) return rows;
  return rows.map((row, index) => ({...row, text: replacements[index] || row.text}));
}
