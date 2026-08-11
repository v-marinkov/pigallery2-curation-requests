/* eslint-disable @typescript-eslint/no-inferrable-types */
import 'reflect-metadata';
import {SubConfigClass} from 'typeconfig/src/decorators/class/SubConfigClass';
import {ConfigProperty} from 'typeconfig/src/decorators/property/ConfigPropoerty';

@SubConfigClass({softReadonly: true})
export class CurationConfig {
  @ConfigProperty({
    tags: {name: 'Curation SQLite path'},
    description: 'Absolute path, or a path relative to PiGallery2 Database.dbFolder. Keep this on a persistent config/data volume.'
  })
  databasePath: string = 'curation/curation.sqlite';

  @ConfigProperty({
    tags: {name: 'Maximum reason length'},
    description: 'Maximum number of characters accepted for an optional deletion reason.'
  })
  reasonMaxLength: number = 4000;

  @ConfigProperty({
    tags: {name: 'Deletion request access'},
    description: 'Comma-separated access list. Use * for every authenticated user, admin for all administrators, or individual PiGallery2 usernames; for example: admin, family-user. Tokens are case-insensitive. Use user:admin for a non-administrator whose username is admin. Approval and decline remain administrator-only.'
  })
  requesterAllowlist: string = '*';
}

export const initConfig = (extension: {setConfigTemplate: (cfg: typeof CurationConfig) => void}): void => {
  extension.setConfigTemplate(CurationConfig);
};
