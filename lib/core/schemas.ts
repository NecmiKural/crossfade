import { z } from "zod";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^${LABEL}(\\.${LABEL})*$`);
// Upstream hosts must start with a letter, which rules out IP literals in every encoding.
const HOSTNAME_RE = new RegExp(`^[a-z]([a-z0-9-]{0,61}[a-z0-9])?(\\.${LABEL})*$`);
// A segment may not start with "." so "." and ".." can never appear.
const PATH_PREFIX_RE = /^\/$|^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/;
const HEALTH_PATH_RE = /^\/([A-Za-z0-9_~-][A-Za-z0-9._~-]*(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*)?$/;

/** App or version identifier; never contains "--", which separates them in Envoy cluster names. */
export const Slug = z.string().max(40).regex(SLUG_RE, "lowercase letters, digits and single dashes");
export const VersionName = z.string().max(30).regex(SLUG_RE, "lowercase letters, digits and single dashes");
/** Jira-style project key, e.g. SHOP → releases SHOP-R7, incidents SHOP-14. */
export const AppKey = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, "2-10 uppercase letters or digits, starting with a letter");
export const Domain = z.string().max(253).regex(DOMAIN_RE, "a lowercase RFC 1123 hostname");
export const Hostname = z.string().max(253).regex(HOSTNAME_RE, "a lowercase hostname starting with a letter");
export const PathPrefix = z.string().max(100).regex(PATH_PREFIX_RE, "/ or /segment[/segment...] without a trailing slash");
export const Port = z.int().min(1).max(65535);
export const HealthPath = z.string().max(200).regex(HEALTH_PATH_RE, "an absolute path without query or dot segments").default("/healthz");
export const Password = z.string().min(12).max(128);
