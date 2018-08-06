import {Injectable, InjectionToken, Injector} from '@angular/core';
import {FlowActions, FlowSelectors, FlowState} from '@flogo/flow/core/state';
import {Store} from '@ngrx/store';
import {Overlay, OverlayRef} from '@angular/cdk/overlay';
import {ComponentPortal, PortalInjector} from '@angular/cdk/portal';
import {Activity, AppInfo, TaskAddComponent, TASKADD_OPTIONS, TaskAddOptions} from './task-add.component';
import {Observable} from 'rxjs';
import {distinctUntilChanged, map, takeUntil} from 'rxjs/operators';
import {isEqual} from 'lodash';
import {SingleEmissionSubject} from '@flogo/flow/shared/mapper/shared/single-emission-subject';
import {CurrentSelection, SelectionType} from '@flogo/flow/core/models';
import {createTaskAddAction} from '@flogo/flow/task-add-new/models/task-add-action-creator';
import {ActionBase, ActivitySchema} from '@flogo/core';

const isAddSelection = (selection: CurrentSelection) => (selection && selection.type === SelectionType.InsertTask);

@Injectable()
export class AddActivityService {

  private keepPopoverActive: boolean;
  private installedActivities$: Observable<Activity[]>;
  private appAndFlowInfo$: Observable<AppInfo>;
  private destroy$: SingleEmissionSubject;
  private contentPortal: ComponentPortal<TaskAddComponent>;
  private popoverRef: OverlayRef;

  constructor(private store: Store<FlowState>, private injector: Injector, private overlay: Overlay) {}

  startSubscriptions() {
    this.destroy$ = SingleEmissionSubject.create();
    this.installedActivities$ = this.store.select(FlowSelectors.getInstalledActivities);
    this.appAndFlowInfo$ = this.store.select(FlowSelectors.selectAppAndFlowInfo);
    this.store.select(FlowSelectors.selectCurrentSelection).pipe(
      distinctUntilChanged(isEqual),
      takeUntil(this.destroy$),
      map((currentSelection: CurrentSelection) => isAddSelection(currentSelection) ? currentSelection : null)
    ).subscribe((selection) => {
      if (selection) {
        this.openAddActivityPanel();
      } else {
        this.closePopover();
      }
    });
  }

  cancelAddActivity() {
    this.store.dispatch(new FlowActions.CancelCreateItem());
  }

  closeAndDestroy() {
    this.destroy$.emitAndComplete();
    if (this.popoverRef) {
      this.popoverRef.dispose();
      this.popoverRef = null;
    }
  }

  get popoverReference(): OverlayRef {
    return this.popoverRef;
  }

  get shouldKeepActive(): boolean {
    return this.keepPopoverActive;
  }

  private openAddActivityPanel() {
    if (!this.contentPortal) {
      const customTokens = this.createInjectorTokens();
      const injector = new PortalInjector(this.injector, customTokens);
      this.contentPortal = new ComponentPortal(TaskAddComponent, null, injector);
    }
    if (!this.popoverRef) {
      this.popoverRef = this.overlay.create({
        positionStrategy: this.overlay.position()
          .global()
          .centerHorizontally()
          .centerVertically()
      });
    }
    if (!this.popoverRef.hasAttached()) {
      this.popoverRef.attach(this.contentPortal);
    }
  }

  private createInjectorTokens(): WeakMap<InjectionToken<TaskAddOptions>, TaskAddOptions> {
    const taskAddOptions: TaskAddOptions = {
      activities$: this.installedActivities$,
      appAndFlowInfo$: this.appAndFlowInfo$,
      selectActivity: (ref: string, selectedSubFlow?: ActionBase) => this.selectedActivity(ref, selectedSubFlow),
      installedActivity: (schema: ActivitySchema) => this.store.dispatch(new FlowActions.ActivityInstalled(schema)),
      updateActiveState: (isOpen: boolean) => (this.keepPopoverActive = isOpen)
    };
    return new WeakMap<InjectionToken<TaskAddOptions>, TaskAddOptions>()
      .set(TASKADD_OPTIONS, taskAddOptions);
  }

  private closePopover() {
    if (this.popoverRef && this.popoverRef.hasAttached()) {
      this.popoverRef.detach();
    }
    if (this.contentPortal && this.contentPortal.isAttached) {
      this.contentPortal.detach();
    }
  }

  private selectedActivity(ref: string, flowData?: ActionBase) {
    createTaskAddAction(
      this.store,
      {ref, flowData}
    ).subscribe((action: FlowActions.TaskItemCreated) => {
      this.store.dispatch(action);
    });
  }
}