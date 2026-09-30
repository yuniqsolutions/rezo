/** One executable contract row: an id from the manifest, a human-readable title and the run against the fixture. */
import type { FixtureServer } from './fixture-server.ts';

export interface Row {
  readonly id: string;
  readonly title: string;
  run(fixture: FixtureServer): Promise<void>;
}
