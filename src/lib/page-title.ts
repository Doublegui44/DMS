import { getTranslations } from "next-intl/server";

/** `export const generateMetadata = pageTitle("customers")`: the tab title in the UI language. */
export const pageTitle = (key: string) => async () => ({ title: (await getTranslations("titles"))(key) });
