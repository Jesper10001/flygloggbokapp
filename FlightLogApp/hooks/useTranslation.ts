import { useLanguageStore } from '../store/languageStore';
import { translations } from '../constants/i18n';

export function useTranslation() {
  const { language } = useLanguageStore();
  const t = (key: keyof typeof translations.en): string =>
    (translations[language][key] ?? translations.en[key]) as string;
  return { t, language };
}
