import Link from "next/link";
import { z } from "zod";
import { ProjectImport } from "@/components/project-import";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { githubId } from "@/lib/projects";
import { pageUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/guard";
import { projectConfig, projectConnection } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; page?: string; connection?: string }>;
}) {
  const user = await pageUser();
  const query = await searchParams;
  const config = projectConfig();
  const connect = (
    <form method="post" action="/api/github/connect">
      <Button type="submit">Connect GitHub</Button>
    </form>
  );
  const connection = config
    ? await projectConnection(user.id, config)
        .then(async (access) => ({ ...access, installations: await access.client.installations() }))
        .catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 401) return null;
          throw error;
        })
    : null;
  const installations = connection?.installations ?? [];
  const requested = githubId.safeParse(query.installation).data;
  const installation = installations.find(({ id }) => id === requested) ?? installations[0];
  const page = z.coerce.number().int().min(1).max(1000).safeParse(query.page).data ?? 1;
  const [catalog, projects] =
    connection && installation
      ? await Promise.all([
          connection.client.repos(installation.id, page),
          withProjectStore((store) => store.list(user.id)),
        ])
      : [null, []];
  const accessUrl = config ? `https://github.com/apps/${config.slug}/installations/new` : "";
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-medium">Projects</h1>
        <p className="mt-1 text-muted-foreground">
          Import GitHub repositories and browse their files.
        </p>
      </div>
      {!config && <output>GitHub project import is unavailable on this deployment.</output>}
      {query.connection === "failed" && (
        <p role="alert" className="text-destructive">
          GitHub connection did not finish. Connect GitHub to try again.
        </p>
      )}
      {config && !connection && connect}
      {connection && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto">
              Connected as <strong>{connection.login}</strong>
            </p>
            <Button asChild variant="outline">
              <a href={accessUrl}>Configure repository access</a>
            </Button>
            <Button asChild variant="ghost">
              <a href="https://github.com/new">Create repository on GitHub</a>
            </Button>
            <form method="post" action="/api/github/disconnect">
              <Button variant="ghost" type="submit">
                Disconnect
              </Button>
            </form>
          </div>
          {!installation && (
            <output>Install the Nanogent GitHub App and select repositories to import.</output>
          )}
          {installation && catalog && (
            <>
              {installations.length > 1 && (
                <form className="flex flex-wrap items-center gap-3">
                  <label htmlFor="installation">GitHub account</label>
                  <Select defaultValue={installation.id} id="installation" name="installation">
                    {installations.map(({ id, account }) => (
                      <option key={id} value={id}>
                        {account.login}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="outline">
                    Browse
                  </Button>
                </form>
              )}
              <ProjectImport
                key={`${installation.id}:${page}`}
                installation={installation.id}
                repositories={catalog.data.repositories}
                imported={projects
                  .filter((project) => project.installationId === installation.id)
                  .map((project) => project.repositoryId)}
              />
              {(page > 1 || catalog.next) && (
                <nav aria-label="Repository pages" className="flex items-center gap-4 text-link">
                  {page > 1 && (
                    <Link href={`/projects?installation=${installation.id}&page=${page - 1}`}>
                      Previous page
                    </Link>
                  )}
                  {catalog.next && page < 1000 && (
                    <Link href={`/projects?installation=${installation.id}&page=${page + 1}`}>
                      Next page
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
