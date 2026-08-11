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

it('registers and executes the PiGallery2 request/approval workflow without changing the photo', async () => {
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
    assert.deepEqual(albums, ['🗑 Deletion requests', '✓ Approved for deletion', '⚠ Deletion errors']);
    assert.equal(buttons.get('Request deletion')?.config.minUserRole, UserRoles.User);
    assert.equal(buttons.get('Cancel my deletion request')?.config.minUserRole, UserRoles.User);
    assert.equal(buttons.get('Approve deletion (admin only)')?.config.minUserRole, UserRoles.Admin);
    assert.equal(buttons.get('Decline deletion (admin only)')?.config.minUserRole, UserRoles.Admin);
    assert.equal(apiRoles.get('Approve deletion (admin only)'), UserRoles.Admin);
    assert.equal(apiRoles.get('Decline deletion (admin only)'), UserRoles.Admin);
    assert.equal(guards.get('approve-deletion')?.role, UserRoles.User);
    assert.equal(guards.get('decline-deletion')?.role, UserRoles.User);
    assert.equal(guards.get('request-deletion')?.role, UserRoles.User);
    assert.equal(jsonRoutes.get('client-permissions')?.role, UserRoles.User);
    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 1, name: 'anna', role: UserRoles.User}
      ),
      {userName: 'anna', canRequestDeletion: true, canModerateDeletion: false}
    );
    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 2, name: 'bob', role: UserRoles.User}
      ),
      {userName: 'bob', canRequestDeletion: false, canModerateDeletion: false}
    );
    assert.deepEqual(
      jsonRoutes.get('client-permissions')?.callback(
        undefined, undefined, {id: 9, name: 'site-admin', role: UserRoles.Admin}
      ),
      {userName: 'site-admin', canRequestDeletion: true, canModerateDeletion: true}
    );

    const deniedResponses: any[] = [];
    let guardContinued = false;
    guards.get('approve-deletion')!.middleware(
      {session: {context: {user: {id: 1, name: 'ordinary-user', role: UserRoles.User}}}},
      {json: (body: any): void => { deniedResponses.push(body); }},
      (): void => { guardContinued = true; }
    );
    assert.equal(guardContinued, false);
    assert.equal(deniedResponses[0].error.code, 4);
    assert.match(deniedResponses[0].error.message, /Administrator role is required/);
    assert.deepEqual(warnings, [
      'ordinary-user: blocked unauthorized attempt to approve a deletion request'
    ]);
    assert.deepEqual(media.metadata.keywords, ['family']);
    assert.equal(saved.length, 0);

    guards.get('approve-deletion')!.middleware(
      {session: {context: {user: {id: 9, name: 'admin', role: UserRoles.Admin}}}},
      {json: (): void => assert.fail('admin guard must not send a denial')},
      (): void => { guardContinued = true; }
    );
    assert.equal(guardContinued, true);

    guardContinued = false;
    guards.get('request-deletion')!.middleware(
      {session: {context: {user: {id: 2, name: 'bob', role: UserRoles.User}}}},
      {json: (body: any): void => { deniedResponses.push(body); }},
      (): void => { guardContinued = true; }
    );
    assert.equal(guardContinued, false);
    assert.equal(deniedResponses[1].error.code, 4);
    assert.match(deniedResponses[1].error.message, /not allowed to request/);

    guardContinued = false;
    guards.get('request-deletion')!.middleware(
      {session: {context: {user: {id: 9, name: 'site-admin', role: UserRoles.Admin}}}},
      {json: (): void => assert.fail('admin role token must allow the request')},
      (): void => { guardContinued = true; }
    );
    assert.equal(guardContinued, true);

    assert.deepEqual(warnings, [
      'ordinary-user: blocked unauthorized attempt to approve a deletion request',
      'bob: blocked unauthorized attempt to request photo deletion'
    ]);

    await buttons.get('Request deletion')!.callback(
      {}, {data: {customFields: {confirm: true, reason: 'duplicate'}}},
      {id: 1, name: 'anna', role: UserRoles.User}, media, mediaRepository
    );
    assert.deepEqual(media.metadata.keywords, [
      'family', 'pg-curation:delete-pending', 'pg-curation:requested-by:anna'
    ]);
    assert.equal(readFileSync(photoPath, 'utf8'), 'photo remains read only');

    await buttons.get('Cancel my deletion request')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 2, name: 'bob', role: UserRoles.User}, media, mediaRepository
    );
    assert.deepEqual(media.metadata.keywords, [
      'family', 'pg-curation:delete-pending', 'pg-curation:requested-by:anna'
    ]);
    assert.equal(saved.length, 1);

    await buttons.get('Approve deletion (admin only)')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 9, name: 'admin', role: UserRoles.Admin}, media, mediaRepository
    );
    assert.deepEqual(media.metadata.keywords, [
      'family', 'pg-curation:delete-approved', 'pg-curation:requested-by:anna'
    ]);
    assert.equal(saved.length, 2);

    const dbPath = path.join(databaseRoot, 'curation', 'curation.sqlite');
    const database = new Database(dbPath, {readonly: true});
    const item = database.prepare('SELECT state, approved_by_user_name FROM deletion_items').get() as any;
    const request = database.prepare('SELECT requested_by_user_name, reason FROM deletion_requests').get() as any;
    assert.deepEqual(item, {state: 'APPROVED', approved_by_user_name: 'admin'});
    assert.deepEqual(request, {requested_by_user_name: 'anna', reason: 'duplicate'});
    database.close();

    const reindexed = await metadataAfter!({
      input: [photoPath],
      output: {keywords: ['family'], size: {width: 1, height: 1}, fileSize: 1, creationDate: 0}
    });
    assert.deepEqual(reindexed.keywords, [
      'family', 'pg-curation:delete-approved', 'pg-curation:requested-by:anna'
    ]);

    await buttons.get('Cancel my deletion request')!.callback(
      {}, {data: {customFields: {confirm: true}}},
      {id: 1, name: 'anna', role: UserRoles.User}, media, mediaRepository
    );
    assert.deepEqual(media.metadata.keywords, ['family']);
    assert.equal(saved.length, 3);

    const cancelledDatabase = new Database(dbPath, {readonly: true});
    const cancelledItem = cancelledDatabase.prepare(
      'SELECT state, declined_by_user_name FROM deletion_items'
    ).get() as any;
    const cancelledRequest = cancelledDatabase.prepare(
      'SELECT withdrawn_at FROM deletion_requests'
    ).get() as any;
    assert.deepEqual(cancelledItem, {state: 'DECLINED', declined_by_user_name: 'anna'});
    assert.equal(typeof cancelledRequest.withdrawn_at, 'string');
    cancelledDatabase.close();
  } finally {
    await cleanUp();
    rmSync(root, {recursive: true, force: true});
  }
});
