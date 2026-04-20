import type { FastifyPluginAsync } from "fastify";
import { Use, type Financing } from "@real-estate/shared";
import { analyze } from "@real-estate/finance";
import {
  detectSource,
  scrapeProperty,
  normalizeProperty,
} from "@real-estate/fetchers";

interface FromUrlBody {
  url: string;
  financing: Financing;
  use: Use;
}

const fromUrlRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: FromUrlBody }>(
    "/from-url",
    {
      schema: {
        body: {
          type: "object",
          required: ["url", "financing", "use"],
          additionalProperties: false,
          properties: {
            url: { type: "string", format: "uri" },
            financing: {
              type: "object",
              required: ["ltv", "annualRatePct", "years"],
              properties: {
                ltv: { type: "number", minimum: 0, maximum: 1 },
                annualRatePct: { type: "number", minimum: 0, maximum: 30 },
                years: { type: "number", minimum: 1, maximum: 50 },
              },
            },
            use: { type: "string", enum: Object.values(Use) },
          },
        },
      },
    },
    async (request, reply) => {
      const { url, financing, use } = request.body;

      let source;
      try {
        source = detectSource(url);
      } catch (err) {
        return reply.code(400).send({ statusCode: 400, error: "Bad Request", message: String(err) });
      }

      let pageText;
      try {
        const scraped = await scrapeProperty(url);
        pageText = scraped.text;
      } catch (err) {
        request.log.error(err, "scrape failed");
        return reply.code(502).send({
          statusCode: 502,
          error: "Bad Gateway",
          message: "Não foi possível carregar a página do anúncio. Tenta novamente.",
        });
      }

      let normalizeResult;
      try {
        normalizeResult = await normalizeProperty(pageText, url, source);
      } catch (err) {
        request.log.error(err, "normalize failed");
        return reply.code(502).send({
          statusCode: 502,
          error: "Bad Gateway",
          message: `Extração de dados falhou: ${String(err)}`,
        });
      }

      const summary = analyze({
        property: normalizeResult.property,
        financing,
        use,
        region: normalizeResult.region,
      });

      return reply.send(summary);
    },
  );
};

export default fromUrlRoute;
