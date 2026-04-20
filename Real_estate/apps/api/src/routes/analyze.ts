import type { FastifyPluginAsync } from "fastify";
import {
  type Financing,
  type PropertyInput,
  type RegionContext,
  Use,
} from "@real-estate/shared";
import { analyze } from "@real-estate/finance";
import { analyzeBodySchema } from "../schemas/analyze.js";

interface AnalyzeBody {
  property: PropertyInput;
  financing: Financing;
  use: Use;
  region?: RegionContext;
}

const analyzeRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: AnalyzeBody }>(
    "/analyze",
    {
      schema: {
        body: analyzeBodySchema,
        response: {
          200: { type: "object", additionalProperties: true },
          400: {
            type: "object",
            properties: {
              statusCode: { type: "number" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { property, financing, use, region } = request.body;
      const summary = analyze({ property, financing, use, region });
      return reply.send(summary);
    },
  );
};

export default analyzeRoute;
