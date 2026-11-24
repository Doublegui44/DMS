import { getRequestConfig } from "next-intl/server";
import { getUiLocale } from "./current";

// The language comes from the `dms_locale` cookie (D-081); URLs carry no locale prefix.
export default getRequestConfig(async () => {
  const locale = await getUiLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Europe/Paris",
  };
});
