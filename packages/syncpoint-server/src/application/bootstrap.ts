import { clearScopeMatcherRegistry, getScopeMatcher } from "syncpoint-context";
import { clearConstraintEvaluatorRegistry, getConstraintEvaluator } from "syncpoint-governance";
import { clearResourceMatcherRegistry, clearValidatorRegistry, getResourceMatcher, getValidatorsForOperation } from "syncpoint-kernel";
import {
  CODE_PLUGIN_VALIDATORS,
  _resetCodePlugin,
  registerCodePlugin,
} from "syncpoint-plugin-code";
import {
  GENERIC_RESOURCE_TYPES,
  GENERIC_VALIDATORS,
  _resetGenericAgentPlugin,
  registerGenericAgentPlugin,
} from "syncpoint-plugin-generic-agent";

export interface ApplicationBootstrapPluginStatus {
  code: boolean;
  genericAgent: boolean;
}

export interface ApplicationBootstrapStatus {
  initialized: boolean;
  plugins: ApplicationBootstrapPluginStatus;
}

let _initialized = false;

const CODE_VALIDATOR_NAMES = new Set(CODE_PLUGIN_VALIDATORS.map(validator => validator.name));
const GENERIC_VALIDATOR_NAMES = new Set(GENERIC_VALIDATORS.map(validator => validator.name));

function hasValidators(operationType: string, resourceTypes: string[], expectedNames: Set<string>): boolean {
  const registeredNames = new Set(
    getValidatorsForOperation(operationType, resourceTypes).map(validator => validator.name),
  );
  for (const expectedName of expectedNames) {
    if (!registeredNames.has(expectedName)) {
      return false;
    }
  }
  return true;
}

function hasResourceMatchers(resourceTypes: string[]): boolean {
  return resourceTypes.every(resourceType => !!getResourceMatcher(resourceType));
}

function isCodePluginReady(): boolean {
  return !!getResourceMatcher("file") &&
    hasValidators("code_patch", ["file"], CODE_VALIDATOR_NAMES) &&
    !!getConstraintEvaluator("file_forbidden") &&
    !!getConstraintEvaluator("module_forbidden") &&
    !!getScopeMatcher("files") &&
    !!getScopeMatcher("modules");
}

function isGenericAgentPluginReady(): boolean {
  return hasResourceMatchers([...GENERIC_RESOURCE_TYPES]) &&
    hasValidators("artifact_update", ["artifact"], GENERIC_VALIDATOR_NAMES) &&
    !!getConstraintEvaluator("resource_forbidden") &&
    !!getScopeMatcher("resources") &&
    !!getScopeMatcher("assetTypes");
}

export function getApplicationBootstrapStatus(): ApplicationBootstrapStatus {
  return {
    initialized: _initialized,
    plugins: {
      code: isCodePluginReady(),
      genericAgent: isGenericAgentPluginReady(),
    },
  };
}

export function ensureApplicationBootstrap(): ApplicationBootstrapStatus {
  registerCodePlugin();
  registerGenericAgentPlugin();
  _initialized = true;
  return getApplicationBootstrapStatus();
}

export function resetApplicationBootstrapForTest(): void {
  clearValidatorRegistry();
  clearResourceMatcherRegistry();
  clearConstraintEvaluatorRegistry();
  clearScopeMatcherRegistry();
  _resetCodePlugin();
  _resetGenericAgentPlugin();
  _initialized = false;
}
