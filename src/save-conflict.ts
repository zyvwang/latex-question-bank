import type { Bank } from "../shared/types.js";

export interface BankConflictSummary {
  localOnlyItems: number;
  diskOnlyItems: number;
  changedItems: number;
  settingsChanged: boolean;
  chaptersChanged: boolean;
  masteryOptionsChanged: boolean;
  errorReasonOptionsChanged: boolean;
  masteryHistoryChanged: boolean;
}

export function summarizeBankConflict(
  localBank: Bank,
  diskBank: Bank
): BankConflictSummary {
  const localItems = new Map(localBank.items.map((item) => [item.id, item]));
  const diskItems = new Map(diskBank.items.map((item) => [item.id, item]));
  let localOnlyItems = 0;
  let diskOnlyItems = 0;
  let changedItems = 0;

  for (const [id, localItem] of localItems) {
    const diskItem = diskItems.get(id);
    if (!diskItem) {
      localOnlyItems += 1;
    } else if (!sameValue(localItem, diskItem)) {
      changedItems += 1;
    }
  }
  for (const id of diskItems.keys()) {
    if (!localItems.has(id)) diskOnlyItems += 1;
  }

  return {
    localOnlyItems,
    diskOnlyItems,
    changedItems,
    settingsChanged: !sameValue(localBank.settings, diskBank.settings),
    chaptersChanged: !sameValue(localBank.chapters, diskBank.chapters),
    masteryOptionsChanged: !sameValue(
      localBank.masteryOptions,
      diskBank.masteryOptions
    ),
    errorReasonOptionsChanged: !sameValue(
      localBank.errorReasonOptions,
      diskBank.errorReasonOptions
    ),
    masteryHistoryChanged: !sameValue(
      localBank.masteryHistory,
      diskBank.masteryHistory
    )
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
