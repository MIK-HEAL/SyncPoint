import { z } from "zod";
import {
  USER_AGENT_PROVIDER_VALUES,
} from "syncpoint-core";
import {
  exportAgentCards,
  getAgentTeamTemplate,
  importAgentDeclarations,
  initAgentTeam,
  listAgentTeamTemplates,
  migrateRuntimeAgentsToDeclaredManifests,
  validateAgentDeclarations,
} from "../application/agent-registration-service.js";
import { publicProcedure, t } from "./_trpc.js";

const manifestFormatInput = z.enum(["yaml", "json"]);

const validationInput = z.object({
  sourcePath: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  format: manifestFormatInput.optional(),
}).refine(input => Number(Boolean(input.sourcePath)) + Number(Boolean(input.content)) === 1, {
  message: "Provide exactly one of sourcePath or content.",
});

export const agentRegistrationRouter = t.router({
  listTemplates: publicProcedure
    .query(() => listAgentTeamTemplates()),

  getTemplate: publicProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .query(({ input }) => getAgentTeamTemplate(input.templateId)),

  initTeam: publicProcedure
    .input(z.object({
      templateId: z.string().min(1).optional(),
      namePrefix: z.string().min(1).optional(),
      defaultProvider: z.enum(USER_AGENT_PROVIDER_VALUES).optional(),
      format: manifestFormatInput.optional(),
      sync: z.boolean().optional(),
      force: z.boolean().optional(),
    }).optional())
    .mutation(({ input }) => initAgentTeam(input ?? {})),

  importDeclarations: publicProcedure
    .input(z.object({
      sourcePath: z.string().min(1),
      format: manifestFormatInput.optional(),
      defaultProvider: z.enum(USER_AGENT_PROVIDER_VALUES).optional(),
      namePrefix: z.string().min(1).optional(),
      sync: z.boolean().optional(),
      force: z.boolean().optional(),
    }))
    .mutation(({ input }) => importAgentDeclarations(input)),

  validate: publicProcedure
    .input(validationInput)
    .query(({ input }) => validateAgentDeclarations(input)),

  migrate: publicProcedure
    .input(z.object({
      agentIds: z.array(z.string().min(1)).optional(),
      format: manifestFormatInput.optional(),
      sync: z.boolean().optional(),
      force: z.boolean().optional(),
    }).optional())
    .mutation(({ input }) => migrateRuntimeAgentsToDeclaredManifests(input ?? {})),

  exportCards: publicProcedure
    .input(z.object({
      agentIds: z.array(z.string().min(1)).optional(),
      includeRemoved: z.boolean().optional(),
      sync: z.boolean().optional(),
    }).optional())
    .mutation(({ input }) => exportAgentCards(input ?? {})),
});
