import * as path from 'path';
import {Repository} from 'typeorm';
import {IExtensionObject} from '../../node_modules/pigallery2-extension-kit';
import {IMediaRequestBody} from '../../node_modules/pigallery2-extension-kit/lib/backend/model/extension/IExtension';
import {MediaEntity} from '../../node_modules/pigallery2-extension-kit/lib/backend/model/database/enitites/MediaEntity';
import {IClientMediaButtonConfig} from '../../node_modules/pigallery2-extension-kit/lib/common/entities/extension/IClientUIConfig';
import {UserDTO, UserRoles} from '../../node_modules/pigallery2-extension-kit/lib/common/entities/UserDTO';
import {
  SearchQueryTypes,
  TextSearch,
  TextSearchQueryMatchTypes
} from '../../node_modules/pigallery2-extension-kit/lib/common/entities/SearchQueryDTO';
import {CurationProjection, applyCurationProjection} from '../domain';
import {normalizeRelativeMediaPath} from '../security/paths';
import {ParamsDictionary} from 'express-serve-static-core';

export interface MediaPaths {
  relativePath: string;
  absolutePath: string;
}

type MediaButtonCallback = (
  params: ParamsDictionary,
  body: IMediaRequestBody,
  user: UserDTO,
  media: MediaEntity,
  repository: Repository<MediaEntity>
) => Promise<void>;

/**
 * PiGallery2 3.5.x logs a user out when an extension endpoint protected with
 * Admin returns its authorization response, while also failing to hide the
 * button. Keep the intended UI role on the DTO, authenticate as User at the
 * route, and let the callback enforce Admin before doing any work.
 *
 * Private PiGallery2 UI access is intentionally isolated in this adapter.
 */
export const addMediaButtonWithApiRole = <C>(
  extension: IExtensionObject<C>,
  buttonConfig: IClientMediaButtonConfig,
  apiRole: UserRoles,
  callback: MediaButtonCallback
): void => {
  if (!buttonConfig.apiPath) {
    throw new Error(`Media button ${buttonConfig.name} requires an API path`);
  }
  const internalUI = extension.ui as unknown as {buttonConfigs?: IClientMediaButtonConfig[]};
  if (!Array.isArray(internalUI.buttonConfigs)) {
    throw new Error('Unsupported PiGallery2 UI extension implementation: buttonConfigs is unavailable');
  }
  internalUI.buttonConfigs.push(buttonConfig);
  extension.RESTApi.post.mediaJsonResponse(
    [buttonConfig.apiPath], apiRole, !buttonConfig.skipDirectoryInvalidation, callback
  );
};

export const getMediaPaths = (extension: IExtensionObject<unknown>, media: MediaEntity): MediaPaths => {
  const relativePath = normalizeRelativeMediaPath(
    path.join(media.directory.path || '', media.directory.name || '', media.name)
  );
  return {
    relativePath,
    absolutePath: path.resolve(extension.paths.ImageFolder, ...relativePath.split('/'))
  };
};

export const relativePathFromLoader = (extension: IExtensionObject<unknown>, absolutePath: string): string | null => {
  const relative = path.relative(extension.paths.ImageFolder, absolutePath);
  try {
    return normalizeRelativeMediaPath(relative);
  } catch {
    return null;
  }
};

export const saveCurationProjection = async (
  media: MediaEntity,
  repository: Repository<MediaEntity>,
  projection: CurationProjection | null
): Promise<void> => {
  media.metadata.keywords = applyCurationProjection(media.metadata.keywords, projection);
  await repository.save(media);
};

export const ensureSavedSearches = async (extension: IExtensionObject<unknown>): Promise<void> => {
  const searches: Array<{name: string; keyword: string}> = [
    {name: '✎ Curation · All open', keyword: 'pg-curation:open'},
    {name: '✎ Curation · Pending metadata', keyword: 'pg-curation:metadata-pending'},
    {name: '✓ Curation · Approved metadata', keyword: 'pg-curation:metadata-approved'},
    {name: '✎ Curation · Faces', keyword: 'pg-curation:category:faces'},
    {name: '✎ Curation · Tags', keyword: 'pg-curation:category:tags'},
    {name: '✎ Curation · Location', keyword: 'pg-curation:category:location'},
    {name: '✎ Curation · Date and time', keyword: 'pg-curation:category:date-time'},
    {name: '✎ Curation · Title and caption', keyword: 'pg-curation:category:title-caption'},
    {name: '✎ Curation · Duplicates', keyword: 'pg-curation:category:duplicate'},
    {name: '✎ Curation · Other', keyword: 'pg-curation:category:other'},
    {name: '🗑 Deletion requests', keyword: 'pg-curation:delete-pending'},
    {name: '✓ Approved for deletion', keyword: 'pg-curation:delete-approved'},
    {name: '⚠ Deletion errors', keyword: 'pg-curation:delete-error'}
  ];
  for (const search of searches) {
    await extension._app.objectManagers.AlbumManager.addIfNotExistSavedSearch(search.name, {
      type: SearchQueryTypes.keyword,
      value: search.keyword,
      matchType: TextSearchQueryMatchTypes.exact_match
    } as TextSearch, true);
  }
};
