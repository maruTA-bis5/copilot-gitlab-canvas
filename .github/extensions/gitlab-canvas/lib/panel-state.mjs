import { getMessages, resolveLanguage } from "./i18n.mjs";

export function createPanelClientState(state, mode, languagePreference) {
  const language = resolveLanguage(languagePreference);
  return {
    ...state,
    mode,
    language,
    languagePreference,
    messages: getMessages(language),
  };
}
