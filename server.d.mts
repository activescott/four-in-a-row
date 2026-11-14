import type { Express } from "express";
import type { ServerBuild } from "react-router";

export function createApp(build: ServerBuild): Express;
