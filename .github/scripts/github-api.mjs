import {
  MonaError,
  positive,
  repositoryParts,
  requireSafe,
  same,
  timestamp,
} from './mona-core.mjs';

const ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SHA = /^[a-f\d]{40}$/i;
const MERGE_QUERY = `query MonaMergeCommit($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      id
      state
      merged
      mergedAt
      headRefName
      headRefOid
      baseRefName
      mergeCommit { oid }
    }
  }
}`;
const CLOSING_QUERY = `query MonaClosingIssues($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      headRefOid
      closingIssuesReferences(first: 100, after: $after) {
        totalCount
        nodes { number repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function incomplete() {
  return new MonaError(
    'Mona could not read complete repository evidence. No progress changed; retry the workflow.',
    'API_INCOMPLETE',
  );
}

function integer(value) {
  requireSafe(
    positive(value),
    'Mona stopped: invalid repository object number.',
  );
  return String(value);
}

function nextPage(link, expected, page) {
  if (!link) return false;
  let next = false;
  for (const part of link.split(/,\s*(?=<)/)) {
    const match = /^<([^>]+)>;\s*rel="([a-z ]+)"$/.exec(part.trim());
    if (!match) throw incomplete();
    if (!match[2].split(' ').includes('next')) continue;
    if (next) throw incomplete();
    let url;
    try {
      url = new URL(match[1]);
    } catch {
      throw incomplete();
    }
    if (
      url.origin !== ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== expected.pathname
    )
      throw incomplete();
    const wanted = new URL(expected);
    wanted.searchParams.set('page', String(page + 1));
    const entries = [...url.searchParams.entries()].sort();
    const desired = [...wanted.searchParams.entries()].sort();
    if (JSON.stringify(entries) !== JSON.stringify(desired)) throw incomplete();
    next = true;
  }
  return next;
}

/** Fixed-host, current-repository-only transport. No Projects endpoints, remote
 * URLs from responses, credential checkout, shell, mutation retries or logging. */
export function createGitHubClient({
  token,
  repository,
  fetchImpl = globalThis.fetch,
  maxPages = 20,
  timeoutMs = 10_000,
}) {
  const { owner, name } = repositoryParts(repository);
  requireSafe(
    typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token),
    'Mona needs the workflow built-in GH_TOKEN. Do not supply a PAT or change authentication.',
  );
  requireSafe(
    Number.isSafeInteger(maxPages) &&
      maxPages > 0 &&
      maxPages <= 50 &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= 30_000,
  );
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const request = async (path, method = 'GET', body) => {
    // Paths are generated below, never accepted from an event, Link or body.
    requireSafe(
      path === '/graphql' || path === root || path.startsWith(`${root}/`),
    );
    const url = new URL(path, ORIGIN);
    requireSafe(
      url.origin === ORIGIN && !url.username && !url.password && !url.hash,
    );
    try {
      const response = await fetchImpl(url.href, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'bsp-mona/2',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const expectedStatus =
        method === 'POST' && path !== '/graphql' ? 201 : 200;
      if (response.status !== expectedStatus) {
        // Never echo response bodies, headers, token, event data or fetch errors.
        const status = Number.isSafeInteger(response.status)
          ? response.status
          : 'unknown';
        throw new MonaError(
          `Mona's repository API request was unavailable (HTTP ${status}). No progress was reset; retry with the built-in workflow permissions.`,
          'API_UNAVAILABLE',
        );
      }
      const length = response.headers.get('content-length');
      if (
        length &&
        (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)
      )
        throw incomplete();
      // The timeout signal also bounds response body reads.
      const chunks = [];
      let size = 0;
      if (!response.body) throw incomplete();
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw incomplete();
        chunks.push(chunk);
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw incomplete();
      }
      if (data === null || typeof data !== 'object') throw incomplete();
      return { data, link: response.headers.get('link') };
    } catch (error) {
      if (error instanceof MonaError) throw error;
      throw new MonaError(
        'Mona could not reach the repository API safely. No progress was reset; retry the workflow.',
        'API_UNAVAILABLE',
      );
    }
  };

  const get = async (suffix = '') => (await request(`${root}${suffix}`)).data;
  const write = async (suffix, method, body) =>
    (await request(`${root}${suffix}`, method, body)).data;
  const list = async (suffix, params = {}, identity = (item) => item?.id) => {
    const result = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`${root}${suffix}`, ORIGIN);
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      url.searchParams.set('per_page', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));
      const { data, link } = await request(`${url.pathname}${url.search}`);
      if (!Array.isArray(data) || data.length > PAGE_SIZE) throw incomplete();
      for (const item of data) {
        const id = identity(item);
        if (
          !(positive(id) || (typeof id === 'string' && id.length > 0)) ||
          seen.has(id)
        )
          throw incomplete();
        seen.add(id);
      }
      const more = nextPage(link, url, page);
      if (more && data.length === 0) throw incomplete();
      result.push(...data);
      if (!more && data.length < PAGE_SIZE) return result;
      // A full page without a Link still needs a terminating page. Never accept
      // a cap-limited prefix as a complete list, even if a match was found.
    }
    throw incomplete();
  };

  return Object.freeze({
    getRepository: () => get(),
    listIssues: () =>
      list('/issues', { state: 'all', sort: 'created', direction: 'asc' }),
    getIssue: (number) => get(`/issues/${integer(number)}`),
    createIssue: ({ title, body }) => write('/issues', 'POST', { title, body }),
    updateExercise: (number, body) => {
      requireSafe(
        typeof body === 'string' && body.length > 0 && body.length <= 60_000,
        'Mona stopped: invalid exercise body.',
      );
      return write(`/issues/${integer(number)}`, 'PATCH', { body });
    },
    closeRetiredSample: (number) =>
      write(`/issues/${integer(number)}`, 'PATCH', {
        state: 'closed',
        state_reason: 'not_planned',
      }),
    closeExercise: (number) =>
      write(`/issues/${integer(number)}`, 'PATCH', {
        state: 'closed',
        state_reason: 'completed',
      }),
    listComments: (number) => list(`/issues/${integer(number)}/comments`),
    createComment: (number, body) =>
      write(`/issues/${integer(number)}/comments`, 'POST', { body }),
    updateComment: (id, body) =>
      write(`/issues/comments/${integer(id)}`, 'PATCH', { body }),
    getCollaboratorPermission: (actor) => {
      requireSafe(/^[a-z\d][a-z\d-]{0,38}$/i.test(actor ?? ''));
      return get(`/collaborators/${encodeURIComponent(actor)}/permission`);
    },
    // Official native relationship route, not a body-text or Project field test.
    listBlockedBy: (number) =>
      list(`/issues/${integer(number)}/dependencies/blocked_by`),
    getPullRequest: async (number) => {
      const pr = await get(`/pulls/${integer(number)}`);
      if (
        !positive(pr?.id) ||
        pr.number !== number ||
        typeof pr.merged !== 'boolean'
      )
        throw incomplete();
      // REST 2026-03-10 removed merge_commit_sha. Retain the engines' internal
      // alias, but derive it only from this PR's native GraphQL mergeCommit.
      // An open PR's synthetic test-merge commit is never delivery evidence.
      let mergeSha = null;
      if (pr.merged) {
        const { data } = await request('/graphql', 'POST', {
          query: MERGE_QUERY,
          variables: { owner, name, number },
        });
        if (
          Object.hasOwn(data, 'errors') &&
          (!Array.isArray(data.errors) || data.errors.length)
        )
          throw incomplete();
        const repo = data.data?.repository;
        const native = repo?.pullRequest;
        if (
          !same(repo?.nameWithOwner, repository) ||
          native?.number !== number ||
          typeof pr.node_id !== 'string' ||
          pr.node_id.length === 0 ||
          native.id !== pr.node_id ||
          native.state !== 'MERGED' ||
          native.merged !== true ||
          pr.state !== 'closed' ||
          !timestamp(pr.merged_at) ||
          native.mergedAt !== pr.merged_at ||
          !SHA.test(pr.head?.sha ?? '') ||
          native.headRefOid !== pr.head.sha ||
          typeof pr.head.ref !== 'string' ||
          native.headRefName !== pr.head.ref ||
          typeof pr.base?.ref !== 'string' ||
          native.baseRefName !== pr.base.ref ||
          !SHA.test(native.mergeCommit?.oid ?? '')
        )
          throw incomplete();
        mergeSha = native.mergeCommit.oid;
      }
      return { ...pr, merge_commit_sha: mergeSha };
    },
    listPullRequestFiles: (number) =>
      list(`/pulls/${integer(number)}/files`, {}, (file) => file?.filename),
    readRepositoryFile: async (file, ref) => {
      requireSafe(
        file === 'work/release-checklist.md' &&
          /^[a-f\d]{40}$/i.test(ref ?? ''),
        'Mona stopped: unsafe file or commit reference.',
      );
      const data = await get(
        `/contents/${file}?ref=${encodeURIComponent(ref)}`,
      );
      if (
        data?.type !== 'file' ||
        data.path !== file ||
        data.encoding !== 'base64' ||
        typeof data.content !== 'string' ||
        !Number.isSafeInteger(data.size) ||
        data.size < 0 ||
        data.size > 1024 * 1024
      )
        throw incomplete();
      const encoded = data.content.replace(/\r?\n/g, '');
      if (
        !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
          encoded,
        )
      )
        throw incomplete();
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length !== data.size || bytes.toString('base64') !== encoded)
        throw incomplete();
      return bytes.toString('utf8');
    },
    getClosingIssues: async (number, headSha) => {
      integer(number);
      requireSafe(/^[a-f\d]{40}$/i.test(headSha ?? ''));
      const result = [];
      const cursors = new Set();
      const ids = new Set();
      let after = null;
      let total;
      for (let page = 1; page <= maxPages; page += 1) {
        const { data } = await request('/graphql', 'POST', {
          query: CLOSING_QUERY,
          variables: { owner, name, number, after },
        });
        if (
          Object.hasOwn(data, 'errors') &&
          (!Array.isArray(data.errors) || data.errors.length)
        )
          throw incomplete();
        const repo = data.data?.repository;
        const pr = repo?.pullRequest;
        const refs = pr?.closingIssuesReferences;
        if (
          !same(repo?.nameWithOwner, repository) ||
          pr?.number !== number ||
          pr.headRefOid !== headSha ||
          !refs ||
          !Array.isArray(refs.nodes) ||
          refs.nodes.length > PAGE_SIZE ||
          !Number.isSafeInteger(refs.totalCount) ||
          refs.totalCount < 0 ||
          typeof refs.pageInfo?.hasNextPage !== 'boolean'
        )
          throw incomplete();
        if (total !== undefined && refs.totalCount !== total)
          throw incomplete();
        total = refs.totalCount;
        for (const node of refs.nodes) {
          if (
            !positive(node?.number) ||
            typeof node.repository?.nameWithOwner !== 'string'
          )
            throw incomplete();
          repositoryParts(node.repository.nameWithOwner);
          const id = `${node.repository.nameWithOwner.toLowerCase()}#${node.number}`;
          if (ids.has(id)) throw incomplete();
          ids.add(id);
        }
        result.push(...refs.nodes);
        if (result.length > total) throw incomplete();
        if (!refs.pageInfo.hasNextPage) {
          if (result.length !== total) throw incomplete();
          return result;
        }
        const cursor = refs.pageInfo.endCursor;
        if (
          refs.nodes.length === 0 ||
          typeof cursor !== 'string' ||
          !cursor.length ||
          cursor.length > 1024 ||
          cursors.has(cursor) ||
          result.length >= total
        )
          throw incomplete();
        cursors.add(cursor);
        after = cursor;
      }
      throw incomplete();
    },
  });
}
