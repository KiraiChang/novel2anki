export const BASIC_FRONT = `{{Front}}`;
export const BASIC_BACK = `{{FrontSide}}<hr id="answer">{{Back}}`;
export const CLOZE_FRONT = `{{cloze:Text}}<br><small style="color:#888">{{Hint}}</small>`;
export const CLOZE_BACK = `{{cloze:Text}}<br><small style="color:#888">{{Hint}}</small>`;

export const CARD_CSS = `
.card { font-family: 'Noto Sans TC', sans-serif; font-size: 16px; line-height: 1.6; padding: 20px; }
.word { font-size: 24px; font-weight: bold; color: #2c3e50; }
.definition { color: #555; margin-top: 8px; }
.example { color: #666; font-style: italic; margin-top: 12px; border-left: 3px solid #3498db; padding-left: 10px; }
.character-name { font-size: 22px; font-weight: bold; color: #8e44ad; }
.plot-q { font-weight: bold; color: #e67e22; }
hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }
`;
