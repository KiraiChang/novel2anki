import { cleanText } from '../../../nlp/textCleaner';

describe('cleanText', () => {
  it('should join hyphenated line breaks', () => {
    expect(cleanText('extra-\nordinary')).toBe('extraordinary');
  });

  it('should normalize multiple spaces to single space', () => {
    expect(cleanText('hello   world')).toBe('hello world');
  });

  it('should remove control characters but keep newlines', () => {
    const withControl = 'hello\x08world';
    expect(cleanText(withControl)).toBe('hello world');
  });

  it('should preserve English punctuation', () => {
    const prose = "He said, 'Hello!' and left.";
    expect(cleanText(prose)).toBe("He said, 'Hello!' and left.");
  });

  it('should normalize curly quotes to ASCII', () => {
    expect(cleanText('‘hello’')).toBe("'hello'");
    expect(cleanText('“hello”')).toBe('"hello"');
  });

  it('should normalize em dash to spaced hyphen', () => {
    expect(cleanText('word—word')).toBe('word - word');
  });

  it('should not modify normal English prose', () => {
    const prose = 'The quick brown fox jumps over the lazy dog.';
    expect(cleanText(prose)).toBe(prose);
  });
});
