import { z } from "zod";

export const githubId = z.string().regex(/^[1-9][0-9]{0,15}$/);
export const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
export const repositoryPath = z
  .string()
  .max(1024)
  .refine(
    (path) =>
      path === "" ||
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            part.isWellFormed() &&
            !/[\\\p{Cc}]/u.test(part),
        ),
  );

export type ProjectInput = {
  installationId: string;
  repositoryId: string;
  fullName: string;
  branch: string;
  commitSha: string;
};
export type Project = ProjectInput & { id: string };
