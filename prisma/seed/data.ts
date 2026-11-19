/** Static reference data for the seed. Prices are illustrative, not real OEM list prices. */

export const SITES = [
  {
    code: "NTE",
    slug: "nantes",
    name: "Nantes Atlantique",
    address: "12 boulevard des Martyrs Nantais",
    postalCode: "44200",
    city: "Nantes",
    phone: "02 40 00 10 10",
    labourRateCents: 9500,
    brands: ["PEUGEOT", "RENAULT"],
  },
  {
    code: "REN",
    slug: "rennes",
    name: "Rennes Saint-Grégoire",
    address: "3 rue du Bignon",
    postalCode: "35760",
    city: "Saint-Grégoire",
    phone: "02 99 00 20 20",
    labourRateCents: 9200,
    brands: ["PEUGEOT"],
  },
  {
    code: "ANG",
    slug: "angers",
    name: "Angers Beaucouzé",
    address: "45 avenue du Grand Périgné",
    postalCode: "49070",
    city: "Beaucouzé",
    phone: "02 41 00 30 30",
    labourRateCents: 8900,
    brands: ["RENAULT"],
  },
] as const;

export const BRANDS = [
  { code: "PEUGEOT", name: "Peugeot", wmi: "VF3", oemName: "Peugeot France (OEM)" },
  { code: "RENAULT", name: "Renault", wmi: "VF1", oemName: "Renault France (OEM)" },
] as const;

type Fuel = "PETROL" | "DIESEL" | "HYBRID" | "PLUGIN_HYBRID" | "ELECTRIC";

export interface ModelDef {
  model: string;
  versions: { name: string; fuel: Fuel; co2: number; hp: number; priceEuros: number }[];
}

/** VN catalogue used to build new-vehicle stock (proper catalogue module arrives in Phase 3). */
export const VN_MODELS: Record<string, ModelDef[]> = {
  PEUGEOT: [
    {
      model: "208",
      versions: [
        { name: "Active 1.2 PureTech 75", fuel: "PETROL", co2: 128, hp: 75, priceEuros: 19_900 },
        { name: "Allure 1.2 Hybrid 100 e-DCS6", fuel: "HYBRID", co2: 102, hp: 100, priceEuros: 25_300 },
        { name: "GT E-208 156", fuel: "ELECTRIC", co2: 0, hp: 156, priceEuros: 34_400 },
      ],
    },
    {
      model: "2008",
      versions: [
        { name: "Style 1.2 Hybrid 136", fuel: "HYBRID", co2: 110, hp: 136, priceEuros: 29_800 },
        { name: "GT E-2008 156", fuel: "ELECTRIC", co2: 0, hp: 156, priceEuros: 38_900 },
      ],
    },
    {
      model: "308",
      versions: [
        { name: "Allure 1.2 Hybrid 136", fuel: "HYBRID", co2: 115, hp: 136, priceEuros: 33_200 },
        { name: "GT Plug-in Hybrid 180", fuel: "PLUGIN_HYBRID", co2: 24, hp: 180, priceEuros: 44_600 },
        { name: "Allure BlueHDi 130 EAT8", fuel: "DIESEL", co2: 119, hp: 130, priceEuros: 34_900 },
      ],
    },
    {
      model: "3008",
      versions: [
        { name: "Allure Hybrid 136", fuel: "HYBRID", co2: 122, hp: 136, priceEuros: 38_500 },
        { name: "GT E-3008 210", fuel: "ELECTRIC", co2: 0, hp: 210, priceEuros: 48_900 },
      ],
    },
    {
      model: "5008",
      versions: [{ name: "Allure Hybrid 136 7 places", fuel: "HYBRID", co2: 125, hp: 136, priceEuros: 41_900 }],
    },
  ],
  RENAULT: [
    {
      model: "Clio",
      versions: [
        { name: "Evolution TCe 90", fuel: "PETROL", co2: 118, hp: 90, priceEuros: 20_400 },
        { name: "Techno E-Tech full hybrid 145", fuel: "HYBRID", co2: 96, hp: 145, priceEuros: 26_100 },
      ],
    },
    {
      model: "Captur",
      versions: [
        { name: "Techno TCe 90", fuel: "PETROL", co2: 125, hp: 90, priceEuros: 25_500 },
        { name: "Esprit Alpine E-Tech full hybrid 145", fuel: "HYBRID", co2: 105, hp: 145, priceEuros: 32_300 },
      ],
    },
    {
      model: "Mégane E-Tech",
      versions: [{ name: "Techno EV60 220", fuel: "ELECTRIC", co2: 0, hp: 220, priceEuros: 40_900 }],
    },
    {
      model: "Austral",
      versions: [
        { name: "Techno mild hybrid 160", fuel: "HYBRID", co2: 128, hp: 160, priceEuros: 36_900 },
        { name: "Iconic E-Tech full hybrid 200", fuel: "HYBRID", co2: 105, hp: 200, priceEuros: 44_200 },
      ],
    },
    {
      model: "Scénic E-Tech",
      versions: [{ name: "Esprit Alpine 87 kWh 220", fuel: "ELECTRIC", co2: 0, hp: 220, priceEuros: 47_500 }],
    },
    {
      model: "Arkana",
      versions: [{ name: "Techno E-Tech full hybrid 145", fuel: "HYBRID", co2: 108, hp: 145, priceEuros: 34_400 }],
    },
  ],
};

/** Makes/models seen as used cars and customer vehicles. */
export const VO_MODELS: { make: string; wmi: string; brandCode?: string; models: { model: string; version: string; fuel: Fuel; hp: number; newPriceEuros: number }[] }[] = [
  {
    make: "Peugeot",
    wmi: "VF3",
    brandCode: "PEUGEOT",
    models: [
      { model: "208", version: "Allure 1.2 PureTech 100", fuel: "PETROL", hp: 100, newPriceEuros: 22_000 },
      { model: "308", version: "Active BlueHDi 130", fuel: "DIESEL", hp: 130, newPriceEuros: 30_000 },
      { model: "3008", version: "GT Line BlueHDi 130", fuel: "DIESEL", hp: 130, newPriceEuros: 36_000 },
      { model: "2008", version: "Allure PureTech 130", fuel: "PETROL", hp: 130, newPriceEuros: 27_000 },
    ],
  },
  {
    make: "Renault",
    wmi: "VF1",
    brandCode: "RENAULT",
    models: [
      { model: "Clio", version: "Intens TCe 100", fuel: "PETROL", hp: 100, newPriceEuros: 19_500 },
      { model: "Captur", version: "Intens TCe 130", fuel: "PETROL", hp: 130, newPriceEuros: 25_000 },
      { model: "Mégane", version: "Business Blue dCi 115", fuel: "DIESEL", hp: 115, newPriceEuros: 27_000 },
      { model: "Zoe", version: "Zen R110", fuel: "ELECTRIC", hp: 110, newPriceEuros: 32_000 },
    ],
  },
  {
    make: "Citroën",
    wmi: "VF7",
    models: [
      { model: "C3", version: "Shine PureTech 83", fuel: "PETROL", hp: 83, newPriceEuros: 18_000 },
      { model: "C5 Aircross", version: "Feel BlueHDi 130", fuel: "DIESEL", hp: 130, newPriceEuros: 33_000 },
    ],
  },
  {
    make: "Volkswagen",
    wmi: "WVW",
    models: [
      { model: "Golf", version: "Life 1.5 TSI 130", fuel: "PETROL", hp: 130, newPriceEuros: 31_000 },
      { model: "Polo", version: "Life 1.0 TSI 95", fuel: "PETROL", hp: 95, newPriceEuros: 22_000 },
    ],
  },
  {
    make: "Toyota",
    wmi: "SB1",
    models: [
      { model: "Yaris", version: "Dynamic Hybrid 116", fuel: "HYBRID", hp: 116, newPriceEuros: 23_500 },
      { model: "C-HR", version: "Design Hybrid 122", fuel: "HYBRID", hp: 122, newPriceEuros: 31_000 },
    ],
  },
  {
    make: "Dacia",
    wmi: "UU1",
    models: [
      { model: "Sandero", version: "Stepway TCe 90", fuel: "PETROL", hp: 90, newPriceEuros: 15_500 },
      { model: "Duster", version: "Journey Blue dCi 115", fuel: "DIESEL", hp: 115, newPriceEuros: 22_500 },
    ],
  },
  {
    make: "Ford",
    wmi: "WF0",
    models: [{ model: "Puma", version: "Titanium EcoBoost 125 mHEV", fuel: "HYBRID", hp: 125, newPriceEuros: 27_500 }],
  },
];

export const COLOURS = [
  "Blanc Nacré",
  "Noir Perla",
  "Gris Platinium",
  "Gris Artense",
  "Bleu Vertigo",
  "Rouge Elixir",
  "Blanc Glacier",
  "Gris Cassiopée",
  "Bleu Iron",
  "Rouge Flamme",
];

/** Approval thresholds (business assumption #7). */
export const APPROVAL_RULES = [
  { key: "deal.discount", label: "Discount above 5 % of list price", thresholdBp: 500, role: "SALES_MANAGER" },
  { key: "deal.discount", label: "Discount above 10 % of list price", thresholdBp: 1000, role: "DEALER_PRINCIPAL" },
] as const;

/** Group-wide settings (business assumptions). Values are editable in Admin → Settings later. */
export const SETTINGS: Record<string, unknown> = {
  "sales.reservationDays": 7,
  "sales.stockAgeingThresholdsDays": [60, 90, 120],
  "sales.commission": { frontEndMarginBp: 1000, perAddOnCents: 5000, financeCommissionBp: 2000 },
  "workshop.labourRates": { customerCents: 9500, warrantyCents: 8000, internalCents: 6000 },
  "accounting.paymentTermsDays": { INDIVIDUAL: 0, COMPANY: 30, OEM: 45 },
  "accounting.fiscalYearStartMonth": 1,
  "accounting.collectiveCustomerAccount": "411",
  "accounting.marginSchemeMention": "Régime particulier – Biens d'occasion (art. 297 A du CGI)",
  "parts.allowNegativeStock": false,
  "locale.default": "fr-FR",
};
