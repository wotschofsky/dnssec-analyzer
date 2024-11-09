// Greatly based on https://github.com/wotschofsky/domain-digger/blob/4094fb866aa2541eaa7f1a1db8c0783aee155993/lib/whois.ts

import whoiser, { type WhoisSearchResult } from 'whoiser';

import { getBaseDomain } from '../utils';
import { getPublicSuffix } from 'tldts';
import { UNSUPPORTED_WHOIS_TLDS } from './constants';

const parseDateSafe = (date: string): Date | null => {
  const parsed = new Date(date);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
};

export const lookupWhois = async (domain: string) => {
  const result = await whoiser(domain, {
    raw: true,
    timeout: 5000,
  });

  const mappedResults: Record<string, string> = {};
  for (const key in result) {
    mappedResults[key] = (result[key] as WhoisSearchResult).__raw as string;
  }

  const filteredResults = Object.entries(mappedResults).filter(
    ([_key, value]) => Boolean(value)
  );

  return filteredResults;
};

const UNREGISTERED_INDICATORS = [
  'available for registration',
  'is free', // .nl
  'no data found',
  'no match',
  'no object found',
  'not been registered',
  'not found',
  'status: free',
];

const resolveRegistrarResult = (whois: {
  registrar: string | null;
  createdAt: Date | null;
  dnssec: string | null;
}) => {
  if (whois.registrar) return whois.registrar;
  if (whois.createdAt || whois.dnssec) return 'unknown';
  return null;
};

export const getWhoisSummary = async (domain: string) => {
  const tld = getPublicSuffix(domain);
  if (!tld || UNSUPPORTED_WHOIS_TLDS.includes(tld)) {
    return {
      registrar: 'unknown',
      createdAt: null,
    };
  }

  const baseDomain = getBaseDomain(domain);

  try {
    const results = await whoiser(baseDomain, {
      timeout: 5000,
      raw: true,
    });

    const resultsKey = Object.keys(results).find(
      // @ts-expect-error
      (key) => !('error' in results[key])
    );
    if (!resultsKey) {
      throw new Error('No valid results found for domain ' + domain);
    }
    const firstResult = results[resultsKey] as WhoisSearchResult;

    if (
      UNREGISTERED_INDICATORS.some((indicator) =>
        firstResult['__raw'].toString().toLowerCase().includes(indicator)
      )
    ) {
      return {
        registrar: 'not registered',
        createdAt: null,
      };
    }

    const tempRegistrar = firstResult['Registrar']?.toString() || null;
    const createdAt =
      firstResult && 'Created Date' in firstResult
        ? parseDateSafe(firstResult['Created Date'].toString())
        : null;
    const dnssec = firstResult['DNSSEC']?.toString() || null;

    return {
      registrar: resolveRegistrarResult({
        registrar: tempRegistrar,
        createdAt,
        dnssec,
      }),
      createdAt,
    };
  } catch (error) {
    console.warn(`${domain}: ${error.message}`);
    return {
      registrar: null,
      createdAt: null,
    };
  }
};
