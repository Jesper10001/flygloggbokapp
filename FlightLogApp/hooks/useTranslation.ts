import { useLanguageStore } from '../store/languageStore';
import { translations } from '../constants/i18n';

export function useTranslation() {
  const { language } = useLanguageStore();
  // Språket är låst till engelska — indexera alltid en-blocket.
  const t = (key: keyof typeof translations.en): string =>
    (translations.en[key] ?? key) as string;
  return { t, language };
}
