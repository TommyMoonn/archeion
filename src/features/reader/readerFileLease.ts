import { markPerformance } from "../../utils/measurePerformance";

export type ReaderSourceHandoff = Readonly<{
  blob: Blob;
  release: () => void;
}>;

export type ReaderFileLease = Readonly<{
  acquire: () => Promise<ReaderSourceHandoff>;
  dispose: () => void;
  requestKey: string;
}>;

type ReaderFileLeaseOptions = {
  initialBlob: Blob;
  load: () => Promise<Blob>;
  requestKey: string;
};

type OwnedReaderSource = {
  blob: Blob;
  borrowers: number;
  released: boolean;
};

const SOURCE_RELEASE_MARK = "archeion:reader-source-bytes-released";

export function createReaderFileLease({
  initialBlob,
  load,
  requestKey,
}: ReaderFileLeaseOptions): ReaderFileLease {
  let disposed = false;
  let source: OwnedReaderSource | null = {
    blob: initialBlob,
    borrowers: 0,
    released: false,
  };
  let pendingSource: Promise<OwnedReaderSource> | null = null;

  const markSourceReleased = (ownedSource: OwnedReaderSource) => {
    if (ownedSource.released || ownedSource.borrowers !== 0) return;
    ownedSource.released = true;
    markPerformance(SOURCE_RELEASE_MARK);
  };

  const retireSource = (ownedSource: OwnedReaderSource) => {
    if (source === ownedSource) source = null;
    markSourceReleased(ownedSource);
  };

  const acquireSource = async (): Promise<OwnedReaderSource> => {
    if (disposed) throw new Error("The Reader file lease has ended.");
    if (source) return source;

    pendingSource ??= load().then((blob) => ({
      blob,
      borrowers: 0,
      released: false,
    }));

    let loadedSource: OwnedReaderSource;
    try {
      loadedSource = await pendingSource;
    } finally {
      pendingSource = null;
    }

    if (disposed) {
      markSourceReleased(loadedSource);
      throw new Error("The Reader file lease has ended.");
    }

    source ??= loadedSource;
    return source;
  };

  return Object.freeze({
    acquire: async () => {
      const ownedSource = await acquireSource();
      ownedSource.borrowers += 1;
      let released = false;

      return Object.freeze({
        blob: ownedSource.blob,
        release: () => {
          if (released) return;
          released = true;
          ownedSource.borrowers = Math.max(0, ownedSource.borrowers - 1);
          if (ownedSource.borrowers === 0) retireSource(ownedSource);
        },
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (source) retireSource(source);
    },
    requestKey,
  });
}
