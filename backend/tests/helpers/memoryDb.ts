// A small in-memory stand-in for the parts of Firestore the app uses, shared by
// every module in the end-to-end test so they all see the same data.

type Data = Record<string, any>;
type Op = "==" | "<" | "<=" | ">" | ">=";

interface Filter {
  field: string;
  op: Op;
  value: unknown;
}

const compare = (a: any, b: any, op: Op): boolean => {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  switch (op) {
    case "==":
      return left === right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
};

export function createMemoryDb() {
  const store = new Map<string, Data>();
  let nextId = 1;

  const docRef = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
    collection,
    get: async () => snapshot(collection, id),
    set: async (data: Data) => void store.set(`${collection}/${id}`, { ...data }),
    update: async (data: Data) => {
      const path = `${collection}/${id}`;
      if (!store.has(path)) throw new Error(`No document to update: ${path}`);
      store.set(path, { ...store.get(path), ...data });
    },
  });

  const snapshot = (collection: string, id: string) => {
    const data = store.get(`${collection}/${id}`);
    return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined), ref: docRef(collection, id) };
  };

  const query = (collection: string, filters: Filter[], order?: { field: string; dir: "asc" | "desc" }, max?: number) => {
    const run = () => {
      let docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/"))
        .filter(([, data]) => filters.every((f) => compare(data[f.field], f.value, f.op)))
        .map(([path]) => snapshot(collection, path.slice(collection.length + 1)));
      if (order) {
        const sign = order.dir === "desc" ? -1 : 1;
        const key = (d: Data | undefined) => {
          const v = d?.[order.field];
          return v instanceof Date ? v.getTime() : v;
        };
        docs = docs.sort((a, b) => (key(a.data()) > key(b.data()) ? sign : key(a.data()) < key(b.data()) ? -sign : 0));
      }
      if (max !== undefined) docs = docs.slice(0, max);
      return { empty: docs.length === 0, size: docs.length, docs };
    };
    const q: any = {
      collection,
      filters,
      where: (field: string, op: Op, value: unknown) => query(collection, [...filters, { field, op, value }], order, max),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query(collection, filters, { field, dir }, max),
      limit: (n: number) => query(collection, filters, order, n),
      get: async () => run(),
      run,
    };
    return q;
  };

  const db = {
    collection: (name: string) => ({
      doc: (id: string = `auto${nextId++}`) => docRef(name, id),
      add: async (data: Data) => {
        const ref = docRef(name, `auto${nextId++}`);
        await ref.set(data);
        return ref;
      },
      where: (field: string, op: Op, value: unknown) => query(name, [{ field, op, value }]),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query(name, [], { field, dir }),
      limit: (n: number) => query(name, [], undefined, n),
      get: async () => query(name, []).run(),
    }),
    // Reads see committed data; writes are applied together once the callback succeeds.
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: async (target: any) => (target.path ? snapshot(target.collection, target.id) : target.run()),
        set: (ref: any, data: Data) => writes.push(() => store.set(ref.path, { ...data })),
        update: (ref: any, data: Data) =>
          writes.push(() => {
            if (!store.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
            store.set(ref.path, { ...store.get(ref.path), ...data });
          }),
      });
      writes.forEach((apply) => apply());
      return result;
    },
  };

  return { db, store, reset: () => store.clear() };
}
