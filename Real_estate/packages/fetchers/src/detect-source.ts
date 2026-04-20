import { Source } from "@real-estate/shared";

const DOMAIN_MAP: [string, Source][] = [
  ["idealista.pt", Source.IDEALISTA],
  ["imovirtual.com", Source.IMOVIRTUAL],
  ["casa.sapo.pt", Source.CASA_SAPO],
  ["casayes.pt", Source.CASAYES],
  ["quatru.pt", Source.QUATRU],
];

export function detectSource(url: string): Source {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    throw new Error(`URL inválido: ${url}`);
  }

  for (const [domain, source] of DOMAIN_MAP) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return source;
    }
  }
  throw new Error(
    `Fonte não suportada: ${hostname}. Fontes aceites: ${DOMAIN_MAP.map(([d]) => d).join(", ")}`,
  );
}
