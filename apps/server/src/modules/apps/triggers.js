import pick from 'lodash/pick';
import mapKeys from 'lodash/mapKeys';

import { AppsManager } from './index';
import { TriggerManager as TriggerContribManager } from '../triggers';
import { ContribsManager as ContribDeviceManager } from '../contribs';
import { apps as appsDb, dbUtils } from '../../common/db';
import { ErrorManager, ERROR_TYPES, ERROR_TYPES as GENERAL_ERROR_TYPES } from '../../common/errors';
import { CONSTRAINTS } from '../../common/validation';
import { findGreatestNameIndex } from '../../common/utils/collection';
import { getProfileType } from '../../common/utils/profile';
import { FLOGO_PROFILE_TYPES, REF_TRIGGER_LAMBDA } from "../../common/constants";
import { normalizeName } from '../exporter/utils/normalize-name';

import { Validator } from './validator';
import { buildBinary, buildPlugin } from './build';

const EDITABLE_FIELDS_CREATION = [
  'name',
  'ref',
  'description',
  'settings',
];

const EDITABLE_FIELDS_UPDATE = [
  'name',
  'description',
  'settings',
];

const getComparableTriggerName = fromName =>  fromName.trim().toLowerCase();

const nameExists = (triggerId, name, triggers) => {
  const comparableName = getComparableTriggerName(name);
  return !!triggers.find(
    currentTrigger => getComparableTriggerName(currentTrigger.name) === comparableName && currentTrigger.id !== triggerId,
  );
};

/**
{
  "id": "my_rest_trigger",
  "name": "My rest trigger",
  "description": "My rest trigger description",
  "updatedAt": "2017-07-14T01:00:00+01:00Z",
  "createdAt": "2017-07-14T01:00:00+01:00Z",
  "ref": "github.com/TIBCOSoftware/flogo-contrib/trigger/rest",
  "settings": {
    "port": "9233"
  },
  "handlers": [
    {
      "actionId": "my_simple_flow",
      "settings": {
        "method": "GET",
        "path": "/test"
      },
      "actionMappings": {
        "input": [
          { "type": 1, "value": "content.customerId", "mapTo": "customerId" },
          { "type": 1, "value": "content.orderId", "mapTo": "orderId" }
        ],
        "output": [
          { "type": 1, "value": "responseCode", "mapTo": "status" },
          { "type": 1, "value": "responseData", "mapTo": "data" }
        ]
      }
    },
    {
      "actionId": "my_simple_flow_2",
      "settings": {
        "method": "GET",
        "path": "/test2"
      },
      "actionMappings": {
        "input": [
          { "type": 1, "value": "content.customerId", "mapTo": "customerId" },
          { "type": 1, "value": "content.orderId", "mapTo": "orderId" }
        ],
        "output": [
          { "type": 1, "value": "responseCode", "mapTo": "status" },
          { "type": 1, "value": "responseData", "mapTo": "data" }
        ]
      }
    }
  ]
}
 */
export class AppsTriggersManager {

  static create(appId, triggerData) {
    if (!appId) {
      return Promise.reject(ErrorManager.makeError('App not found', { type: ERROR_TYPES.COMMON.NOT_FOUND }));
    }

    return appsDb.findOne({ _id: appId }, { triggers: 1 , device: 1})
      .then(app => {
        if (!app) {
          throw ErrorManager.makeError('App not found', { type: ERROR_TYPES.COMMON.NOT_FOUND });
        }

        const appProfile = getProfileType(app);
        const errors = Validator.validateTriggerCreate(triggerData);
        if (errors) {
          throw ErrorManager.createValidationError('Validation error', errors);
        }

        let triggerContribPromise;
        if(appProfile === FLOGO_PROFILE_TYPES.MICRO_SERVICE){
          triggerContribPromise = TriggerContribManager.findByRef(triggerData.ref);
        } else {
          triggerContribPromise = ContribDeviceManager.findByRef(triggerData.ref);
        }

        return triggerContribPromise
          .then(contribTrigger => {
            if (!contribTrigger) {
              throw ErrorManager.createValidationError('Validation error', [{
                property: 'ref',
                title: 'Trigger not installed',
                detail: 'The specified ref for contrib is not installed',
                value: triggerData.ref,
                type: CONSTRAINTS.NOT_INSTALLED_TRIGGER,
              }]);
            }
            triggerData.name = ensureUniqueName(app.triggers, triggerData.name);
            return triggerData;
          });
      })
      .then(newTrigger => {
        newTrigger = cleanInput(triggerData, EDITABLE_FIELDS_CREATION);

        newTrigger.id = dbUtils.generateShortId();
        newTrigger.name = newTrigger.name.trim();
        newTrigger.createdAt = dbUtils.ISONow();
        newTrigger.updatedAt = null;
        newTrigger.handlers = [];

        return appsDb.update({ _id: appId }, { $push: { triggers: newTrigger } })
          .then(() => {
            newTrigger.appId = appId;
            return newTrigger;
          });
      });
  }

  static update(triggerId, triggerData) {
    const appNotFound = ErrorManager.makeError('App not found', { type: ERROR_TYPES.COMMON.NOT_FOUND });

    return AppsTriggersManager.findOne(triggerId)
      .then(trigger => {
        if (!trigger) {
          throw appNotFound;
        }
        const errors = Validator.validateTriggerUpdate(triggerData);
        if (errors) {
          throw ErrorManager.createValidationError('Validation error', errors);
        }

        triggerData = cleanInput(triggerData, EDITABLE_FIELDS_UPDATE);

        return _atomicUpdate(triggerData, trigger.appId)
          .then(updatedCount => (updatedCount > 0 ? AppsTriggersManager.findOne(triggerId) : null));
      });

    function _atomicUpdate(triggerFields, appId) {
      return new Promise((resolve, reject) => {
        const appQuery = { _id: appId };
        const updateQuery = {};

        appsDb.findOne(appQuery, { triggers: 1 })
          .then(app => {
            if (!app) {
              return reject(appNotFound);
            }

            if (triggerFields.name) {
              if (nameExists(triggerId, triggerFields.name, app.triggers)) {
                // do nothing
                return reject(ErrorManager.createValidationError('Validation error', [{
                  property: 'name',
                  title: 'Name already exists',
                  detail: 'There\'s another trigger in the app with this name',
                  value: {
                    triggerId,
                    appId: app.id,
                    name: triggerFields.name,
                  },
                  type: CONSTRAINTS.UNIQUE,
                }]));
              }
            }

            const triggerIndex = app.triggers.findIndex(t => t.id === triggerId);
            const modifierPrefix = `triggers.${triggerIndex}`;
            triggerFields.updatedAt = dbUtils.ISONow();
            // makes { $set: { 'triggers.1.name': 'my trigger' } };
            updateQuery.$set = mapKeys(triggerFields, (v, fieldName) => `${modifierPrefix}.${fieldName}`);
            return appsDb.update(appQuery, updateQuery);
          })
          .then(count => resolve(count))
          .catch(e => reject(e));
      });
    }
  }

  static findOne(triggerId) {
    return appsDb.findOne({ 'triggers.id': triggerId }, { triggers: 1 })
      .then(app => {
        if (!app) {
          return null;
        }
        const trigger = app.triggers.find(t => t.id === triggerId);
        trigger.appId = app._id;
        return trigger;
      });
  }

  static list(appId, { name }) {
    return appsDb.findOne({ _id: appId })
      .then(app => (app && app.triggers ? app.triggers : []))
      .then(triggers => {
        if (name) {
          const findName = getComparableTriggerName(name);
          return triggers.filter(trigger => findName === getComparableTriggerName(trigger.name));
        }
        return triggers;
      });
  }

  static remove(triggerId) {
    return appsDb.update(
      { 'triggers.id': triggerId },
      { $pull: { triggers: { id: triggerId } } },
    ).then(numRemoved => numRemoved > 0);
  }

  /**
   * Builds an app in shim mode and returns the generated file
   * @param triggerId {string} trigger to build
   * @params options
   * @params options.compile.os: target operating system
   * @params options.compile.arch: target architecture
   * @params options.shimTriggerId: create an app using shim mode using specified trigger id
   * @return {{ trigger: string, appName: string, data: Stream }} built handler zip file
   * @throws Not found error if trigger not found
   */
  static async buildShim(triggerId, options) {
    const trigger = await AppsTriggersManager.findOne(triggerId);
    if (!trigger) {
      throw ErrorManager.makeError('Cannot build shim for unknown trigger id', { type: GENERAL_ERROR_TYPES.COMMON.NOT_FOUND });
    }
    const build = trigger.ref === REF_TRIGGER_LAMBDA ? buildPlugin : buildBinary;
    return build(() => AppsManager.export(trigger.appId), { ...options, shimTriggerId: normalizeName(trigger.name) });
  }

}

function cleanInput(trigger, fields) {
  const cleanTrigger = pick(trigger, fields);
  if (cleanTrigger.name) {
    cleanTrigger.name = cleanTrigger.name.trim();
  }
  return cleanTrigger;
}


function ensureUniqueName(triggers, name) {
  const greatestIndex = findGreatestNameIndex(name, triggers);
  if (greatestIndex >= 0) {
    name = `${name} (${greatestIndex + 1})`;
  }
  return name;
}
