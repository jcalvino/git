import Anthropic from "@anthropic-ai/sdk";
import {
  CondLevel,
  EnergyCert,
  PropertyType,
  Source,
  type PropertyInput,
} from "@real-estate/shared";

const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

const SYSTEM = `És um extrator de dados imobiliários portugueses. Dado o texto de um anúncio, devolves APENAS JSON válido — sem markdown, sem texto adicional.

Campos obrigatórios:
- priceEUR: number (preço pedido em EUR, sem pontos de milhar)
- areaM2: number (área bruta em m², usa área total se disponível)
- typology: string (ex: "T2", "T3", "Moradia T4")
- freguesia: string (freguesia ou bairro em Portugal)
- energyCert: "APLUS"|"A"|"B"|"BMINUS"|"C"|"D"|"E"|"F"|"G"|"UNKNOWN"
- condition: "L1_COSMETIC" (novo/renovado) | "L2_STANDARD" (bom estado, obras ligeiras) | "L3_STRUCTURAL" (obras pesadas/ruína) | "UNKNOWN"
- isInARU: boolean (true se mencionado ARU, zona de reabilitação urbana)
- propertyType: "RESIDENTIAL_APARTMENT"|"RESIDENTIAL_HOUSE"|"HOTEL_UNIT"|"TOURIST_APARTMENT"
- yearBuilt: number|null
- bedrooms: number|null
- bathrooms: number|null

Campos opcionais de contexto regional (inclui se visível na página):
- medianPriceM2EUR: number|null
- grossRentMonthlyEstimateEUR: number|null`;

interface RawExtracted {
  priceEUR?: unknown;
  areaM2?: unknown;
  typology?: unknown;
  freguesia?: unknown;
  energyCert?: unknown;
  condition?: unknown;
  isInARU?: unknown;
  propertyType?: unknown;
  yearBuilt?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  medianPriceM2EUR?: unknown;
  grossRentMonthlyEstimateEUR?: unknown;
}

export interface NormalizeResult {
  property: PropertyInput;
  region?: {
    medianPriceM2EUR?: number;
    grossRentMonthlyEstimateEUR?: number;
  };
}

function toEnergyCert(v: unknown): EnergyCert {
  const map: Record<string, EnergyCert> = {
    "A+": EnergyCert.APLUS,
    APLUS: EnergyCert.APLUS,
    A: EnergyCert.A,
    B: EnergyCert.B,
    "B-": EnergyCert.BMINUS,
    BMINUS: EnergyCert.BMINUS,
    C: EnergyCert.C,
    D: EnergyCert.D,
    E: EnergyCert.E,
    F: EnergyCert.F,
    G: EnergyCert.G,
  };
  return (typeof v === "string" && map[v.toUpperCase()]) || EnergyCert.UNKNOWN;
}

function toCondLevel(v: unknown): CondLevel {
  if (typeof v !== "string") return CondLevel.UNKNOWN;
  if (Object.values(CondLevel).includes(v as CondLevel)) return v as CondLevel;
  return CondLevel.UNKNOWN;
}

function toPropertyType(v: unknown): PropertyType {
  if (typeof v !== "string") return PropertyType.RESIDENTIAL_APARTMENT;
  if (Object.values(PropertyType).includes(v as PropertyType)) return v as PropertyType;
  return PropertyType.RESIDENTIAL_APARTMENT;
}

export async function normalizeProperty(
  pageText: string,
  sourceUrl: string,
  source: Source,
): Promise<NormalizeResult> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extrai os dados deste anúncio imobiliário:\n\n${pageText}`,
      },
    ],
  });

  const raw = message.content[0];
  if (raw.type !== "text") throw new Error("Resposta inesperada do modelo");

  let parsed: RawExtracted;
  try {
    parsed = JSON.parse(raw.text.trim()) as RawExtracted;
  } catch {
    throw new Error(`Falha ao parsear JSON do modelo: ${raw.text.slice(0, 200)}`);
  }

  if (typeof parsed.priceEUR !== "number" || parsed.priceEUR <= 0)
    throw new Error("Não foi possível extrair o preço do anúncio");
  if (typeof parsed.areaM2 !== "number" || parsed.areaM2 <= 0)
    throw new Error("Não foi possível extrair a área do anúncio");

  const property: PropertyInput = {
    sourceUrl,
    source,
    priceEUR: parsed.priceEUR,
    areaM2: parsed.areaM2,
    typology: typeof parsed.typology === "string" ? parsed.typology : "Desconhecido",
    freguesia: typeof parsed.freguesia === "string" ? parsed.freguesia : "Desconhecida",
    energyCert: toEnergyCert(parsed.energyCert),
    condition: toCondLevel(parsed.condition),
    isInARU: parsed.isInARU === true,
    propertyType: toPropertyType(parsed.propertyType),
    yearBuilt: typeof parsed.yearBuilt === "number" ? parsed.yearBuilt : undefined,
    bedrooms: typeof parsed.bedrooms === "number" ? parsed.bedrooms : undefined,
    bathrooms: typeof parsed.bathrooms === "number" ? parsed.bathrooms : undefined,
  };

  const region: NormalizeResult["region"] = {};
  if (typeof parsed.medianPriceM2EUR === "number") region.medianPriceM2EUR = parsed.medianPriceM2EUR;
  if (typeof parsed.grossRentMonthlyEstimateEUR === "number")
    region.grossRentMonthlyEstimateEUR = parsed.grossRentMonthlyEstimateEUR;

  return { property, region: Object.keys(region).length ? region : undefined };
}
