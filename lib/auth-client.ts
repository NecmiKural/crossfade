"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client; same origin as the dashboard. */
export const authClient = createAuthClient();
