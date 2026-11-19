import { getRequestConfig } from "next-intl/server";

// English only for now (D-011). Locale routing can be added when fr/es messages exist.
export default getRequestConfig(async () => {
  const locale = "en";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Europe/Paris",
  };
});
