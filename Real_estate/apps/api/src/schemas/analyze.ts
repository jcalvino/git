import {
  CondLevel,
  EnergyCert,
  PropertyType,
  Source,
  Use,
} from "@real-estate/shared";

const propertyTypes = Object.values(PropertyType);
const sources = Object.values(Source);
const energyCerts = Object.values(EnergyCert);
const condLevels = Object.values(CondLevel);
const useValues = Object.values(Use);

export const analyzeBodySchema = {
  type: "object",
  required: ["property", "financing", "use"],
  additionalProperties: false,
  properties: {
    property: {
      type: "object",
      required: [
        "sourceUrl",
        "source",
        "priceEUR",
        "areaM2",
        "typology",
        "freguesia",
        "energyCert",
        "condition",
        "isInARU",
        "propertyType",
      ],
      additionalProperties: false,
      properties: {
        sourceUrl: { type: "string", format: "uri" },
        source: { type: "string", enum: sources },
        priceEUR: { type: "number", minimum: 1 },
        areaM2: { type: "number", minimum: 1 },
        typology: { type: "string", minLength: 1 },
        freguesia: { type: "string", minLength: 1 },
        energyCert: { type: "string", enum: energyCerts },
        condition: { type: "string", enum: condLevels },
        isInARU: { type: "boolean" },
        propertyType: { type: "string", enum: propertyTypes },
        yearBuilt: { type: "number", minimum: 1800, maximum: 2100 },
        bedrooms: { type: "number", minimum: 0 },
        bathrooms: { type: "number", minimum: 0 },
      },
    },
    financing: {
      type: "object",
      required: ["ltv", "annualRatePct", "years"],
      additionalProperties: false,
      properties: {
        ltv: { type: "number", minimum: 0, maximum: 1 },
        annualRatePct: { type: "number", minimum: 0, maximum: 30 },
        years: { type: "number", minimum: 1, maximum: 50 },
      },
    },
    use: { type: "string", enum: useValues },
    region: {
      type: "object",
      additionalProperties: false,
      properties: {
        medianPriceM2EUR: { type: "number", minimum: 0 },
        medianRentM2EUR: { type: "number", minimum: 0 },
        imiRatePct: { type: "number", minimum: 0 },
        grossRentMonthlyEstimateEUR: { type: "number", minimum: 0 },
        liquidityScore: { type: "number", minimum: 0, maximum: 10 },
      },
    },
  },
} as const;
