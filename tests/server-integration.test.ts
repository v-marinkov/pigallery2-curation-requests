import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {IExtensionObject} from '../node_modules/pigallery2-extension-kit';
import {UserRoles} from '../node_modules/pigallery2-extension-kit/lib/common/entities/UserDTO';
import {CurationConfig} from '../config';
import {cleanUp, init} from '../server';

type ButtonCallback = (...args: any[]) => Promise<void>;
type MetadataAfter = (data: any) => Promise<any>;
type RouteMiddleware = (req: any, res: any, next: () => void) => void;
type JsonCallback = (params?: any, body?: any, user?: any) => unknown;

it('executes general curation and deletion workflows without changing the photo', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pg2-server-test-'));
  const imageRoot = path.join(root, 'images');
  const databaseRoot = path.join(root, 'db');
  const directory = path.join(imageRoot, '2024', 'Christmas');
  mkdirSync(directory, {recursive: true});
  mkdirSync(databaseRoot, {recursive: true});
  const photoPath = path.join(directory, 'photo.jpg');
  writeFileSync(photoPath, 'photo remains read only');

  const buttons = new Map<string, {config: any; callback: ButtonCallback}>();
  const apiRoles = new Map<string, UserRoles>();
  const guards = new Map<string, {role: UserRoles; middleware: RouteMiddleware}>();
  const jsonRoutes = new Map<string, {role: UserRoles; callback: JsonCallback}>();
  const uiButtonConfigs: any[] = [];
  const warnings: string[] = [];
  let metadataAfter: MetadataAfter | null = null;
  const albums: string[] = [];
  const extension = {
    config: {getConfig: (): CurationConfig => ({
      databasePath: 'curation/curation.sqlite', reasonMaxLength: 4000, requesterAllowlist: 'admin, anna'
    })},
    paths: {DBFolder: databaseRoot, ImageFolder: imageRoot},
    Logger: {
      info: (): void => undefined,
      debug: (): void => undefined,
      warn: (message: string): void => { warnings.push(message); }
    },
    _app: {objectManagers: {AlbumManager: {
      addIfNotExistSavedSearch: async (name: string): Promise<void> => { albums.push(name); }
    }}},
    events: {gallery: {MetadataLoader: {loadPhotoMetadata: {
      after: (handler: MetadataAfter): void => { metadataAfter = handler; }
    }}}},
    RESTApi: {
      get: {
        jsonResponse: (paths: string[], role: UserRoles, callback: JsonCallback): string => {
          jsonRoutes.set(paths[0], {role, callback});
          return paths[0];
        }
      },
      post: {
        mediaJsonResponse: (
          paths: string[], role: UserRoles, _invalidate: boolean, callback: ButtonCallback
        ): string => {
          const config = uiButtonConfigs.find(entry => entry.apiPath === paths[0]);
          buttons.set(config.name, {config, callback});
          apiRoles.set(config.name, role);
          return paths[0];
        },
        rawMiddleware: (paths: string[], role: UserRoles, middleware: RouteMiddleware): string => {
          guards.set(paths[0], {role, middleware});
          return paths[0];
        }
      }
    },
    ui: {
      buttonConfigs: uiButtonConfigs,
      addMediaButton: (config: any, callback: ButtonCallback): void => {
        uiButtonConfigs.push(config);
        buttons.set(config.name, {config, callback});
      }
    }
  } as unknown as IExtensionObject<CurationConfig>;

  const media = {
    id: 7,
    name: 'photo.jpg',
    directory: {path: '2024/', name: 'Christmas'},
    metadata: {keywords: ['family']}
  } as any;
  const saved: any[] = [];
  const mediaRepository = {save: async (value: any): Promise<void> => { saved.push(value); }};

  try {
    await init(extension);
    assert.deepEqual(albums, [
      '✎ Curation · All open',
      '✎ Curation · Faces',
      '✎ Curation · Tags',
      '✎ Curation · Location',
      '✎ Curation · Date and time',
      '✎ Curation · Title and caption',
      '✎ Curation · Duplicates',
      '✎ Curation · Other',
      '🗑 Deletion requests',
      '✓ Approved for deletion',
      '⚠ Deletion errors'
    ]);
    assert.equal(buttons.get('Request curation')?.config.minUserRole, UserRoles.User);
    assert.deepEqual(
      buttons.get('Request curation')?.config.popup.customFields.map((field: any) => field.id),
      ['deletion', 'faces', 'tags', 'location', 'dateTime', 'titleCaption', 'duplicate', 'other', 'comment']
    );
    assert.equal(buttons.get('Cancel my curation requests')?.config.minUserRole, UserRoles.User);
    assert.equal(buttons.get('Resolve metadata requests (admin only)')?.config.minUserRole, UserRoles.Admin);
    assert.equal(buttons.get('Approve deletion (admin only)')?.config.minUserRole, UserRoles.Admin);
    assert.equal(apiRoles.get('Resolve metadata requests (admin only)'), UserRoles.Admin);
    assert.equal(guards.get('request-curation')?.role, UserRoles.User);
    assert.equal(guards.get('approve-deletion')?.role, UserRoles.User);
    assert.equal(jsonRoutes.get('client-permissions')?.role, UserRoles.User);
    assert.equal(jsonRoutes.get('request-details/:token')?.role, UserRoles.User);

    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 1, name: 'anna', role: UserRoles.User}
      ),
      {userId: '1', userName: 'anna', canRequestCuration: true, canModerateCuration: false}
    );
    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 2, name: 'bob', role: UserRoles.User}
      ),
      {userId: '2', userName: 'bob', canRequestCuration: false, canModerateCuration: false}
    );
    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 9, name: 'site-admin', role: UserRoles.Admin}
      ),
      {userId: '9', userName: 'site-admin', canRequestCuration: true, canModerateCuration: true}
    );

    const deniedResponses: any[] = [];
    let guardContinued = false;
    guards.get('approve-deletion')!.middleware(
      {session: {context: {user: {id: 2, name: 'bob', role: UserRoles.User}}}},
      {json: (body: any): void => { deniedResponses.push(body); }},
      (): void => { guardContinued = true; }
    );
    assert.equal(guardContinued, false);
    assert.equal(deniedResponses[0].error.code, 4);

    guards.get('request-curation')!.middleware(
      {
        session: {context: {user: {id: 2, name: 'bob', role: UserRoles.User}}},
        body: {data: {customFields: {faces: true}}}
      },
      {json: (body: any): void => { deniedResponses.push(body); }},
      (): void => { guardContinued = true; }
    );
    assert.equal(deniedResponses[1].error.code, 4);

    guards.get('request-curation')!.middleware(
      {
        session: {context: {user: {id: 1, name: 'anna', role: UserRoles.User}}},
        body: {data: {customFields: {comment: 'nothing selected'}}}
      },
      {json: (body: any): void => { deniedResponses.push(body); }},
      (): void => { guardContinued = true; }
    );
    assert.equal(deniedResponses[2].error.code, 50);
    assert.match(deniedResponses[2].error.message, /Select at least one/);

    await buttons.get('Request curation')!.callback(
      {},
      {data: {customFields: {
        deletion: true,
        faces: true,
        other: true,
        comment: 'Duplicate and missing people'
      }}},
      {id: 1, name: 'anna', role: UserRoles.User},
      media,
      mediaRepository
    );
    assert.equal(readFileSync(photoPath, 'utf8'), 'photo remains read only');
    assert.ok(media.metadata.keywords.includes('family'));
    assert.ok(media.metadata.keywords.includes('pg-curation:delete-pending'));
    assert.ok(media.metadata.keywords.includes('pg-curation:open'));
    assert.ok(media.metadata.keywords.includes('pg-curation:category:faces'));
    assert.ok(media.metadata.keywords.includes('pg-curation:category:other'));
    assert.ok(media.metadata.keywords.includes('pg-curation:requested-by:anna'));
    const itemTag = media.metadata.keywords.find((keyword: string) => keyword.startsWith('pg-curation:item:'));
    assert.match(itemTag || '', /^pg-curation:item:[a-f0-9]{32}$/);
    const token = itemTag!.split(':').at(-1);

    const ownerDetails = jsonRoutes.get('request-details/:token')?.callback(
      {token}, undefined, {id: 1, name: 'anna', role: UserRoles.User}
    ) as any;
    assert.deepEqual(ownerDetails.requests.map((request: any) => request.category), [
      'deletion', 'faces', 'other'
    ]);
    const strangerDetails = jsonRoutes.get('request-details/:token')?.callback(
      {token}, undefined, {id: 2, name: 'bob', role: UserRoles.User}
    ) as any;
    assert.deepEqual(strangerDetails, {requests: []});

    await buttons.get('Resolve metadata requests (admin only)')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 2, name: 'bob', role: UserRoles.User}, media, mediaRepository
    );
    await buttons.get('Approve deletion (admin only)')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 2, name: 'bob', role: UserRoles.User}, media, mediaRepository
    );

    const dbPath = path.join(databaseRoot, 'curation', 'curation.sqlite');
    const database = new Database(dbPath, {readonly: true});
    assert.deepEqual(
      database.prepare('SELECT state, requested_by_user_name, reason FROM deletion_items JOIN deletion_requests ON deletion_items.id = deletion_requests.deletion_item_id').get(),
      {state: 'PENDING', requested_by_user_name: 'anna', reason: 'Duplicate and missing people'}
    );
    assert.deepEqual(
      database.prepare('SELECT category, state, comment FROM metadata_requests ORDER BY id').all(),
      [
        {category: 'faces', state: 'OPEN', comment: 'Duplicate and missing people'},
        {category: 'other', state: 'OPEN', comment: 'Duplicate and missing people'}
      ]
    );
    database.close();

    await buttons.get('Approve deletion (admin only)')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 9, name: 'admin', role: UserRoles.Admin}, media, mediaRepository
    );
    await buttons.get('Resolve metadata requests (admin only)')!.callback(
      {}, {data: {customFields: {confirm: true, resolutionComment: 'XMP fixed'}}},
      {id: 9, name: 'admin', role: UserRoles.Admin}, media, mediaRepository
    );
    assert.ok(media.metadata.keywords.includes('pg-curation:delete-approved'));
    assert.ok(!media.metadata.keywords.some((keyword: string) => keyword.startsWith('pg-curation:category:')));

    const reindexed = await metadataAfter!({
      input: [photoPath],
      output: {keywords: ['family'], size: {width: 1, height: 1}, fileSize: 1, creationDate: 0}
    });
    assert.ok(reindexed.keywords.includes('pg-curation:delete-approved'));

    await buttons.get('Cancel my curation requests')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 1, name: 'anna', role: UserRoles.User}, media, mediaRepository
    );
    assert.deepEqual(media.metadata.keywords, ['family']);
    assert.equal(saved.length, 4);
    assert.ok(warnings.some(message => message.includes('blocked unauthorized attempt')));
  } finally {
    await cleanUp();
    rmSync(root, {recursive: true, force: true});
  }
});
