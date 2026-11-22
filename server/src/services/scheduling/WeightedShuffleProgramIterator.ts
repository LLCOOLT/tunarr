import type { CondensedChannelProgram } from '@tunarr/types';
import { uniqBy } from 'lodash-es';
import type { Random } from 'random-js';
import { IndexBasedProgramIterator } from './ProgramIterator.ts';
import type { PassWeighting } from './rerunWeighting.ts';
import {
  programWeight,
  recencyFromAirOrder,
  weightedPassOrder,
} from './rerunWeighting.ts';
import type { ProgramIteratorSnapshot } from './slotIteratorState.ts';
import type { SlotSchedulerProgram } from './slotSchedulerUtil.ts';

const NoRecency: ReadonlyMap<string, number> = new Map();

/**
 * A shuffle that plays every program once per pass, like
 * `ShuffleProgramIterator`, but orders each pass by weight: programs that
 * aired early in the previous pass (longest ago) and, in `unwatched` mode,
 * programs the account has not watched come up sooner.
 *
 * The planned order of the current pass goes into the snapshot. A resumed
 * pass follows it rather than weighing again, so a cascade rebuild reproduces
 * the pass even after the watch state changed. Programs added since are
 * weighed onto the end.
 */
export class WeightedShuffleProgramIterator<
  ProgramT extends CondensedChannelProgram,
> extends IndexBasedProgramIterator<ProgramT> {
  readonly #allPrograms: SlotSchedulerProgram[];
  // Programs aired in the current pass, in air order.
  #airOrder: string[] = [];

  constructor(
    programs: SlotSchedulerProgram[],
    private readonly random: Random,
    private readonly weighting: PassWeighting,
    private readonly minter: (program: SlotSchedulerProgram) => ProgramT,
    resume?: ProgramIteratorSnapshot,
  ) {
    super([]);
    this.#allPrograms = uniqBy(programs, (program) => program.uuid);

    if (resume?.type !== 'shuffle') {
      this.programs = this.weighPass(this.#allPrograms, NoRecency);
      return;
    }

    const byId = new Map(
      this.#allPrograms.map((program) => [program.uuid, program]),
    );
    this.#airOrder = resume.playedIds.filter((id) => byId.has(id));
    const played = new Set(this.#airOrder);

    const planned = (resume.order ?? []).filter(
      (id) => byId.has(id) && !played.has(id),
    );
    const plannedSet = new Set(planned);
    const newcomers = this.#allPrograms.filter(
      (program) => !played.has(program.uuid) && !plannedSet.has(program.uuid),
    );

    const remaining = [
      ...planned.flatMap((id) => {
        const program = byId.get(id);
        return program ? [program] : [];
      }),
      ...this.weighPass(newcomers, NoRecency),
    ];

    if (remaining.length > 0) {
      this.programs = remaining;
    } else {
      this.startNewPass();
    }
  }

  protected mint(program: SlotSchedulerProgram): ProgramT {
    return this.minter(program);
  }

  next(): void {
    if (this.programs.length === 0) {
      return;
    }
    const curr = this.programs[this.position];
    if (curr) {
      this.#airOrder.push(curr.uuid);
    }
    super.next();
    // IndexBasedProgramIterator#next wraps modulo the list length, so a
    // position of 0 means the pass just ended.
    if (this.position === 0) {
      this.startNewPass();
    }
  }

  reset(): void {
    this.startNewPass();
    this.lastPlayedId = undefined;
  }

  snapshot(): ProgramIteratorSnapshot | undefined {
    return {
      type: 'shuffle',
      playedIds: [...this.#airOrder],
      order: this.programs.slice(this.position).map((program) => program.uuid),
    };
  }

  private startNewPass() {
    const recency = recencyFromAirOrder(this.#airOrder);
    this.programs = this.weighPass(this.#allPrograms, recency);
    this.position = 0;
    this.#airOrder = [];
  }

  private weighPass(
    programs: readonly SlotSchedulerProgram[],
    recency: ReadonlyMap<string, number>,
  ) {
    return weightedPassOrder(programs, this.random, (program) =>
      programWeight(program.uuid, recency, this.weighting),
    );
  }
}
