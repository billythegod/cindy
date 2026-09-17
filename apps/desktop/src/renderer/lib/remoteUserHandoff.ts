/** View-only send positions survive the DB echo until history owns the row. */
export interface LocalUserHandoff {
  clientId: string;
  role: string;
  localSendPrecedingClientIds?: readonly string[];
}

export function reserveRemoteUser<T extends LocalUserHandoff>(row: T, preceding: readonly T[]): T {
  return { ...row, localSendPrecedingClientIds: preceding.map((message) => message.clientId) };
}

/** Device clocks are not evidence of which turn the user sent into. */
export function projectRemoteUsers<T extends LocalUserHandoff>(messages: readonly T[]): T[] {
  const result = [...messages];
  for (const row of messages) {
    if (row.role !== 'user' || !row.localSendPrecedingClientIds) continue;
    const preceding = new Set(row.localSendPrecedingClientIds);
    result.splice(
      result.findIndex((message) => message.clientId === row.clientId),
      1,
    );
    let after = -1;
    for (let index = 0; index < result.length; index++) {
      if (preceding.has(result[index].clientId)) after = index;
    }
    result.splice(after + 1, 0, row);
  }
  return result;
}

/** Retire once, so later rewind/deletion cannot revive a local reservation. */
export function confirmRemoteUsers<T extends LocalUserHandoff>(
  messages: T[],
  confirmed: ReadonlySet<string>,
): T[] {
  let changed = false;
  const next = messages.map((row) => {
    if (!row.localSendPrecedingClientIds || !confirmed.has(row.clientId)) return row;
    const { localSendPrecedingClientIds: _position, ...message } = row;
    changed = true;
    return message as T;
  });
  return changed ? next : messages;
}
