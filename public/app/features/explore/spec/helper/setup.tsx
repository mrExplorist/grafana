import { waitFor, within } from '@testing-library/dom';
import { render, screen } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { fromPairs } from 'lodash';
import { stringify } from 'querystring';
import React from 'react';
import { Provider } from 'react-redux';
import { Route, Router } from 'react-router-dom';
import { getGrafanaContextMock } from 'test/mocks/getGrafanaContextMock';

import {
  DataSourceApi,
  DataSourceInstanceSettings,
  QueryEditorProps,
  DataSourcePluginMeta,
  PluginType,
} from '@grafana/data';
import {
  setDataSourceSrv,
  setEchoSrv,
  config,
  setLocationService,
  HistoryWrapper,
  LocationService,
} from '@grafana/runtime';
import { DataSourceRef } from '@grafana/schema';
import { GrafanaContext } from 'app/core/context/GrafanaContext';
import { GrafanaRoute } from 'app/core/navigation/GrafanaRoute';
import { Echo } from 'app/core/services/echo/Echo';
import { setLastUsedDatasourceUID } from 'app/core/utils/explore';
import { MIXED_DATASOURCE_NAME } from 'app/plugins/datasource/mixed/MixedDataSource';
import { configureStore } from 'app/store/configureStore';

import { LokiDatasource } from '../../../../plugins/datasource/loki/datasource';
import { LokiQuery } from '../../../../plugins/datasource/loki/types';
import { ExploreId, ExploreQueryParams } from '../../../../types';
import { initialUserState } from '../../../profile/state/reducers';
import ExplorePage from '../../ExplorePage';

type DatasourceSetup = { settings: DataSourceInstanceSettings; api: DataSourceApi };

type SetupOptions = {
  clearLocalStorage?: boolean;
  datasources?: DatasourceSetup[];
  urlParams?: ExploreQueryParams & { [key: string]: string };
  prevUsedDatasource?: { orgId: number; datasource: string };
  mixedEnabled?: boolean;
};

export function setupExplore(options?: SetupOptions): {
  datasources: { [uid: string]: DataSourceApi };
  store: ReturnType<typeof configureStore>;
  unmount: () => void;
  container: HTMLElement;
  location: LocationService;
} {
  // Clear this up otherwise it persists data source selection
  // TODO: probably add test for that too
  if (options?.clearLocalStorage !== false) {
    window.localStorage.clear();
  }

  if (options?.prevUsedDatasource) {
    setLastUsedDatasourceUID(options?.prevUsedDatasource.orgId, options?.prevUsedDatasource.datasource);
  }

  // Create this here so any mocks are recreated on setup and don't retain state
  const defaultDatasources: DatasourceSetup[] = [
    makeDatasourceSetup(),
    makeDatasourceSetup({ name: 'elastic', id: 2 }),
  ];

  if (config.featureToggles.exploreMixedDatasource) {
    defaultDatasources.push(makeDatasourceSetup({ name: MIXED_DATASOURCE_NAME, uid: MIXED_DATASOURCE_NAME, id: 999 }));
  }

  const dsSettings = options?.datasources || defaultDatasources;

  setDataSourceSrv({
    getList(): DataSourceInstanceSettings[] {
      return dsSettings.map((d) => d.settings);
    },
    getInstanceSettings(ref?: DataSourceRef) {
      const allSettings = dsSettings.map((d) => d.settings);
      return allSettings.find((x) => x.name === ref || x.uid === ref || x.uid === ref?.uid) || allSettings[0];
    },
    get(datasource?: string | DataSourceRef | null): Promise<DataSourceApi> {
      let ds: DataSourceApi | undefined;
      if (!datasource) {
        ds = dsSettings[0]?.api;
      } else {
        ds = dsSettings.find((ds) =>
          typeof datasource === 'string'
            ? ds.api.name === datasource || ds.api.uid === datasource
            : ds.api.uid === datasource?.uid
        )?.api;
      }

      if (ds) {
        return Promise.resolve(ds);
      }

      return Promise.reject();
    },
    reload() {},
  });

  setEchoSrv(new Echo());

  const storeState = configureStore();
  storeState.getState().user = {
    ...initialUserState,
    orgId: 1,
    timeZone: 'utc',
  };

  storeState.getState().navIndex = {
    explore: {
      id: 'explore',
      text: 'Explore',
      subTitle: 'Explore your data',
      icon: 'compass',
      url: '/explore',
    },
  };

  const history = createMemoryHistory({
    initialEntries: [{ pathname: '/explore', search: stringify(options?.urlParams) }],
  });

  const location = new HistoryWrapper(history);
  setLocationService(location);

  const contextMock = getGrafanaContextMock({ location });

  const { unmount, container } = render(
    <Provider store={storeState}>
      <GrafanaContext.Provider
        value={{
          ...contextMock,
          config: {
            ...contextMock.config,
            featureToggles: {
              exploreMixedDatasource: options?.mixedEnabled ?? false,
            },
          },
        }}
      >
        <Router history={history}>
          <Route
            path="/explore"
            exact
            render={(props) => <GrafanaRoute {...props} route={{ component: ExplorePage, path: '/explore' }} />}
          />
        </Router>
      </GrafanaContext.Provider>
    </Provider>
  );

  return {
    datasources: fromPairs(dsSettings.map((d) => [d.api.name, d.api])),
    store: storeState,
    unmount,
    container,
    location,
  };
}

function makeDatasourceSetup({
  name = 'loki',
  id = 1,
  uid: uidOverride,
}: { name?: string; id?: number; uid?: string } = {}): DatasourceSetup {
  const uid = uidOverride || `${name}-uid`;
  const type = 'logs';

  const meta: DataSourcePluginMeta = {
    info: {
      author: {
        name: 'Grafana',
      },
      description: '',
      links: [],
      screenshots: [],
      updated: '',
      version: '',
      logos: {
        small: '',
        large: '',
      },
    },
    id: id.toString(),
    module: 'loki',
    name,
    type: PluginType.datasource,
    baseUrl: '',
  };
  return {
    settings: {
      id,
      uid,
      type,
      name,
      meta,
      access: 'proxy',
      jsonData: {},
      readOnly: false,
    },
    api: {
      components: {
        QueryEditor(props: QueryEditorProps<LokiDatasource, LokiQuery>) {
          return (
            <div>
              <input
                aria-label="query"
                defaultValue={props.query.expr}
                onChange={(event) => {
                  props.onChange({ ...props.query, expr: event.target.value });
                }}
              />
              {name} Editor input: {props.query.expr}
            </div>
          );
        },
      },
      name: name,
      uid: uid,
      query: jest.fn(),
      getRef: () => ({ type, uid }),
      meta,
    } as any,
  };
}

export const waitForExplore = (exploreId: ExploreId = ExploreId.left) => {
  return waitFor(async () => {
    const container = screen.getAllByTestId('data-testid Explore');
    return within(container[exploreId === ExploreId.left ? 0 : 1]);
  });
};

export const tearDown = () => {
  window.localStorage.clear();
};

export const withinExplore = (exploreId: ExploreId) => {
  const container = screen.getAllByTestId('data-testid Explore');
  return within(container[exploreId === ExploreId.left ? 0 : 1]);
};
