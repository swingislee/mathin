import type { Agent } from "node:https";
type Address = { address: string; family: number };
type Resolver = (host: string, options: { all: true; verbatim: true }, callback: (error: NodeJS.ErrnoException | null, addresses: Address[]) => void) => void;
type Callback = (error: NodeJS.ErrnoException | null, address?: string | Address[], family?: number) => void;
export function isPublicPushAddress(address: string): boolean;
export function createWebPushLookup(expectedHost: string, resolve?: Resolver): (hostname: string, options: { all?: boolean; family?: number } | number, callback: Callback) => void;
export function createWebPushAgent(endpoint: string, allowedOrigins: string | string[]): Agent;
