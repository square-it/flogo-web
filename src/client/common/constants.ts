/**
 * Enumerations
 */

export enum FLOGO_TASK_TYPE {
  TASK_ROOT,  // this is the type for triggers
  TASK,
  TASK_BRANCH,
  TASK_SUB_PROC,
  TASK_LOOP
}

export enum FLOGO_TASK_STATUS {
  DEFAULT,
  RUNNING,
  DONE
}

export enum FLOGO_PROCESS_TYPE { DEFAULT = 1 }

export enum FLOGO_PROCESS_MODEL { DEFAULT }

export enum FLOGO_TASK_ATTRIBUTE_TYPE {
  STRING,
  INTEGER,
  NUMBER,
  BOOLEAN,
  OBJECT,
  ARRAY,
  PARAMS
}

/**
 * Constants
 */

export const FLOGO_PROCESS_MODELS = {
  'DEFAULT' : 'simple'
};

/* construct the default values fo types */

let defaultValues = <{[key : number] : any}>{};
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.STRING] = '';
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.INTEGER] = 0;
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.NUMBER] = 0.0;
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.BOOLEAN] = false;
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.OBJECT] = {};
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.ARRAY] = [];
defaultValues[FLOGO_TASK_ATTRIBUTE_TYPE.PARAMS] = {};

export const DEFAULT_VALUES_OF_TYPES = defaultValues;
/**
 * Defined in modules
 */

export * from '../app/flogo.flows.detail.diagram/constants';
