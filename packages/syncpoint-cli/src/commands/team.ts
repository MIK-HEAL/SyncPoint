import { Command, Option } from "commander";
import { USER_AGENT_PROVIDER_VALUES } from "syncpoint-adapters";
import {
  initAgentTeam,
  listAgentTeamTemplates,
} from "syncpoint-server/application";

export function registerTeamCommands(program: Command): void {
  program
    .command("team")
    .description("Manage team templates and bulk agent setup")
    .addCommand(
      new Command("list-templates")
        .description("List built-in team templates")
        .option("--json", "Output JSON")
        .action((opts) => {
          const result = listAgentTeamTemplates();
          if (opts.json) {
            console.log(JSON.stringify(result.templates, null, 2));
            return;
          }
          console.table(result.templates.map((template: {
            id: string;
            title: string;
            description: string;
            template: {
              members: unknown[];
            };
          }) => ({
            id: template.id,
            title: template.title,
            description: template.description,
            members: template.template.members.length,
          })));
        })
    )
    .addCommand(
      new Command("init")
        .description("Materialize a built-in team template into declared agent manifests")
        .argument("[templateId]", "Template ID", "delivery-pod")
        .addOption(new Option("--provider <provider>", "Default provider for generated team members").choices([...USER_AGENT_PROVIDER_VALUES]))
        .addOption(new Option("--format <format>", "Target manifest format").choices(["yaml", "json"]))
        .option("--prefix <prefix>", "Name prefix for generated team members")
        .option("--no-sync", "Skip syncing generated declarations into runtime state")
        .option("--force", "Rewrite preferred declaration paths")
        .option("--json", "Output JSON")
        .action((templateId, opts) => {
          const result = initAgentTeam({
            templateId,
            defaultProvider: opts.provider,
            format: opts.format,
            namePrefix: opts.prefix,
            sync: opts.sync,
            force: opts.force === true,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(`Initialized team template: ${result.templateName}`);
          console.table(result.writes.map((write: {
            manifestPath: string;
            format: string;
            written: boolean;
            filePath: string;
          }) => ({
            manifestPath: write.manifestPath,
            format: write.format,
            written: write.written,
            filePath: write.filePath,
          })));
        })
    );
}
