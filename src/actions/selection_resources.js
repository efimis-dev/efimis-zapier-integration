'use strict';

const { getSuccessfulRows } = require('../efimis_response');
const { buildEfimisApiUrl } = require('../efimis_url');

const PAGE_SIZE = 100;

const listRecords = (endpoint, getName) => async (z, bundle) => {
  const response = await z.request({
    url: buildEfimisApiUrl(bundle, endpoint),
    method: 'GET',
    params: {
      pageIndex: bundle.meta?.page ?? 0,
      pageSize: PAGE_SIZE,
    },
  });

  response.throwForStatus();

  return getSuccessfulRows(response.json, `List ${endpoint}`)
    .filter((record) => record.id)
    .map((record) => ({
      id: record.id,
      name: getName(record),
    }));
};

const joinName = (...values) =>
  values.filter(Boolean).join(' — ');

const resources = [
  {
    key: 'division',
    noun: 'Division',
    list: {
      display: {
        label: 'List Divisions',
        description: 'Lists Efimis divisions for dynamic dropdowns.',
        hidden: true,
      },
      operation: {
        perform: listRecords(
          'divisions',
          (division) => division.name || division.title || division.id,
        ),
      },
    },
  },
  {
    key: 'matterType',
    noun: 'Matter Type',
    list: {
      display: {
        label: 'List Matter Types',
        description: 'Lists Efimis matter types for dynamic dropdowns.',
        hidden: true,
      },
      operation: {
        perform: listRecords(
          'mattertypes',
          (matterType) => matterType.name || matterType.title || matterType.id,
        ),
      },
    },
  },
  {
    key: 'client',
    noun: 'Client',
    list: {
      display: {
        label: 'List Clients',
        description: 'Lists Efimis clients for dynamic dropdowns.',
        hidden: true,
      },
      operation: {
        canPaginate: true,
        perform: listRecords(
          'clients',
          (client) =>
            joinName(client.clientNumber, client.sortName) || client.id,
        ),
      },
    },
  },
  {
    key: 'matter',
    noun: 'Matter',
    list: {
      display: {
        label: 'List Matters',
        description: 'Lists Efimis matters for dynamic dropdowns.',
        hidden: true,
      },
      operation: {
        canPaginate: true,
        perform: listRecords(
          'matters',
          (matter) =>
            joinName(matter.matterNumber, matter.title) || matter.id,
        ),
      },
    },
  },
  {
    key: 'entity',
    noun: 'Entity',
    list: {
      display: {
        label: 'List Entities',
        description: 'Lists Efimis entities for billing contact dropdowns.',
        hidden: true,
      },
      operation: {
        canPaginate: true,
        perform: listRecords(
          'entities',
          (entity) =>
            entity.sortName || entity.fullName || entity.email || entity.id,
        ),
      },
    },
  },
];

module.exports = { resources };
