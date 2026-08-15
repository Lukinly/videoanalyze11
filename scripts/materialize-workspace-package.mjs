import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export async function materializeWorkspacePackage(deployRoot, packageName, sourceRoot) {
  if (!deployRoot || !packageName || !sourceRoot) {
    throw new Error("Usage: materialize-workspace-package <deploy-root> <package-name> <source-root>");
  }

  const nodeModulesRoot = resolve(deployRoot, "node_modules");
  const targetRoot = resolve(nodeModulesRoot, ...packageName.split("/"));
  if (!targetRoot.startsWith(`${nodeModulesRoot}${sep}`)) {
    throw new Error(`Invalid package name: ${packageName}`);
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(dirname(targetRoot), { recursive: true });
  await cp(resolve(sourceRoot), targetRoot, { recursive: true, verbatimSymlinks: true });
  await rm(
    resolve(targetRoot, "node_modules", ".pnpm", "node_modules", ...packageName.split("/")),
    { recursive: true, force: true },
  );
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  await materializeWorkspacePackage(...process.argv.slice(2));
}
