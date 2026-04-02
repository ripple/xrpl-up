import { execSync, spawn, ChildProcess } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

export const COMPOSE_PROJECT = 'xrpl-up-local';
export const LOCAL_WS_PORT = 6006;
export const FAUCET_PORT = 3001;
export const LOCAL_WS_URL = `ws://localhost:${LOCAL_WS_PORT}`;
export const FAUCET_URL = `http://localhost:${FAUCET_PORT}`;
export const DEFAULT_IMAGE = 'xrpllabsofficial/xrpld:latest';

const XRPL_UP_DIR = path.join(os.homedir(), '.xrpl-up');
const COMPOSE_FILE = path.join(XRPL_UP_DIR, 'docker-compose.yml');

export { COMPOSE_FILE };

/** Throws if Docker daemon is not running or not installed. */
export function checkDockerAvailable(): void {
  try {
    execSync('docker info', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'Docker is not available.\n' +
        '  Install Docker from https://docker.com and make sure the daemon is running.'
    );
  }
}

/**
 * Returns the absolute path to the faucet build context directory.
 *
 * At runtime (compiled):  __dirname = dist/core/  → ../faucet-server = dist/faucet-server/
 * In dev mode (tsx):      __dirname = src/core/   → fallback to dist/faucet-server/ from project root
 */
function getFaucetBuildContext(): string {
  const fromDist = path.resolve(__dirname, '..', 'faucet-server');

  // If running via tsx (src/core), point at the compiled dist instead
  if (__dirname.includes(`${path.sep}src${path.sep}`)) {
    // Walk up to project root (src/core → src → project root)
    const projectRoot = path.resolve(__dirname, '..', '..');
    return path.join(projectRoot, 'dist', 'faucet-server');
  }

  return fromDist;
}

const RIPPLED_CFG_FILE = path.join(XRPL_UP_DIR, 'rippled.cfg');
const VALIDATORS_CFG_FILE = path.join(XRPL_UP_DIR, 'validators.txt');
/** Extra amendments written by `amendment enable --local`; merged at genesis. */
export const EXTRA_AMENDMENTS_FILE = path.join(XRPL_UP_DIR, 'genesis-amendments.txt');
export { RIPPLED_CFG_FILE };

/**
 * Returns the default rippled.cfg content as a string (pure, no side effects).
 * Exported so callers can display or save it without starting a node.
 */
export function generateRippledConfig(debug = false): string {
  return `
[server]
port_rpc_admin_local
port_ws_admin_local
port_peer

[port_rpc_admin_local]
port = 5005
ip = 127.0.0.1
admin = 127.0.0.1
protocol = http

[port_ws_admin_local]
port = ${LOCAL_WS_PORT}
ip = 0.0.0.0
admin = 0.0.0.0
protocol = ws
send_queue_limit = 500

[port_peer]
port = 51235
ip = 0.0.0.0
protocol = peer

[node_size]
small

[node_db]
type=NuDB
path=/var/lib/rippled/db/nudb
advisory_delete=0

[database_path]
/var/lib/rippled/db

[debug_logfile]
/var/log/rippled/debug.log

[sntp_servers]
time.windows.com
time.apple.com
time.nist.gov
pool.ntp.org

[validators_file]
validators.txt

[rpc_startup]
{ "command": "log_level", "severity": "${debug ? 'debug' : 'warning'}" }

[ssl_verify]
0

# Force-enable amendments at genesis ledger creation.
# The [amendments] stanza only takes effect on the very first start
# (--start flag creates the genesis ledger). Format: <hash> <name>
#
# Hashes verified against rippled 3.1.1 (xrpllabsofficial/xrpld:latest).
# All amendments known to this build are included so the sandbox matches
# a fully-upgraded network. To enable additional amendments, run:
#   xrpl-up amendment enable <name> --local
# then reset and restart the node.
[amendments]
00C1FC4A53E60AB02C864641002B3172F38677E29C26C5406685179B37E1EDAC RequireFullyCanonicalSig
03BDC0099C4E14163ADA272C1B6F6FABB448CC3E51F522F978041E4B57D9158C fixNFTokenReserve
07D43DCE529B15A10827E5E04943B496762F9A88E3268269D69C44BE49E21104 Escrow
08DE7D96082187F6E6578530258C77FAABABE4C20474BDB82F04B021F1A68647 PayChan
0285B7E5E08E1A8E4C15636F0591D87F73CB6A7B6452A932AD72BBC8E5D1CBE3 fixNFTokenDirV1
12523DF04B553A0B1AD74F42DDB741DE8DC06A03FC089A0EF197E2A87F1D8107 fixAMMOverflowOffer
15D61F0C6DB6A2F86BCF96F1E2444FEC54E705923339EC175BD3E517C8B3FF91 fixDisallowIncomingV1
157D2D480E006395B76F948E3E07A45A05FE10230D88A7993C71F97AE4B1F2D1 Checks
1562511F573A19AE9BD103B5D6B9E01B3B46805AEC5D3C4805C902B514399146 CryptoConditions
1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF Credentials
1E7ED950F2F13C4F8E2A54103B74D57D5D298FFDBD005936164EE9E6484C438C fixAMMv1_2
1F4AFA8FA1BC8827AD4C0F682C03A8B671DCDF6B5C4DE36D44243A684103EF88 HardenedValidations
25BA44241B3BD880770BFA4DA21C7180576831855368CBEC6A3154FDE4A7676E fix1781
27CD95EE8E1E5A537FF2F89B6CEB7C622E78E9374EBD7DCBEDFAE21CD6F16E0A fixReducedOffersV1
2BF037D90E1B676B17592A8AF55E88DB465398B4B597AE46EECEE1399AB05699 fixXChainRewardRounding
2CD5286D8D687E98B41102BDD797198E81EA41DF7BD104E6561FEB104EFF2561 fixTakerDryOfferRemoval
2E2FB9CF8A44EB80F4694D38AADAE9B8B7ADAFD2F092E10068E61C98C4F092B0 fixUniversalNumber
30CD365592B8EE40489BA01AE2F7555CAC9C983145871DC82A42A31CF5BAE7D9 DeletableAccounts
31E0DA76FB8FB527CADCDF0E61CB9C94120966328EFA9DCA202135BAF319C0BA fixReducedOffersV2
32A122F1352A4C7B3A6D790362CC34749C5E57FCE896377BFDC6CCD14F6CD627 NonFungibleTokensV1_1
35291ADD2D79EB6991343BDA0912269C817D0F094B02226C1C14AD2858962ED4 fixAMMv1_1
36799EA497B1369B170805C078AEFE6188345F9B3E324C21E9CA3FF574E3C3D6 fixNFTokenNegOffer
3012E8230864E95A58C60FD61430D7E1B4D3353195F2981DC12B0C7C0950FFAC FlowCross
3318EA0CF0755AF15DAC19F2B5C5BCBFF4B78BDD57609ACCAABE2C41309B051A fixFillOrKill
3C43D9A973AA4443EF3FC38E42DD306160FBFFDAB901CD8BAA15D09F2597EB87 NonFungibleTokensV1
3CBC5C4E630A1B82380295CDA84B32B49DD066602E74E39B85EF64137FA65194 DepositPreauth
41765F664A8D67FF03DDB1C1A893DE6273690BA340A6C2B07C8D29D0DD013D3A fixDirectoryLimit
42EEA5E28A97824821D4EF97081FE36A54E9593C6E4F20CBAE098C69D2E072DC fix1373
452F5906C46D46F407883344BFDD90E672B672C5E9943DB4891E3A34FEEEB9DB fixSTAmountCanonicalize
47C3002ABA31628447E8E9A8B315FAA935CE30183F9A9B86845E469CA2CDC3DF DisallowIncoming
4C97EBA926031A7CF7D7B36FDE3ED66DDA5421192D63DE53FFB46E43B9DC8373 MultiSign
4F46DF03559967AC60F2EB272FEFE3928A7594A45FF774B87A7E540DB0F8F068 fixAmendmentMajorityCalc
532651B4FD58DF8922A49BA101AB3E996E5BFBF95A913B3E392504863E63B164 TickSize
56B241D7A43D40354D02A9DC4C8DF5C7A1F930D92A9035C4E12291B3CA3E1C2B Clawback
586480873651E106F1D6339B0C4A8945BA705A777F3F4524626FF1FC07EFE41D MultiSignReserve
58BE9B5968C4DA7C59BA900961828B113E5490699B21877DEF9A31E9D0FE5D5F fix1623
5E9586DB3D765B4C5794658FB6BB385071E9838DF4016027E6E26820C8526724 fixAMMClawbackRounding
621A0B264970359869E3C0363A899909AAB7A887C8B73519E4ECF952D33258A8 fixPayChanRecipientOwnerDir
6143A27B71F7DAF9330ECA7C5EC3D54C8083A4FDEF7016737EEC06AB61E82EE0 fixIncludeKeyletFields
6781F8368C4771B83E8B821D88F580202BCB4228075297B19E4FDC5233F1EFDC TrustSetAuth
6C92211186613F9647A89DFFBAB8F94C99D4C7E956D495270789128569177DA1 fix1512
67A34F2CF55BFC0F93AACD5B281413176FEE195269FA6D95219A2DF738671172 fix1513
73761231F7F3D94EC3D8C63D91BDD0D89045C6F71B917D1925C01253515A6669 fixNonFungibleTokensV1_2
740352F2412A9909880C23A559FCECEDA3BE2126FED62FC7660D628A06927F11 Flow
755C971C29971C9F20C6F080F2ED96F87884E40AD19554A5EBECDCEC8A1F77FE fixEmptyDID
75A7E01C505DD5A179DFE3E000A9B6F1EDDEB55A12F95579A23E15B15DC8BE5A ImmediateOfferKilled
7BB62DC13EC72B775091E9C71BF8CF97E122647693B50C5E87A80DFD6FCFAC50 fixPreviousTxnID
7CA70A7674A26FA517412858659EBC7EDEEF7D2D608824464E6FDEFD06854E14 fixAMMv1_3
83FD6594FF83C1D105BD2B41D7E242D86ECB4A8220BD9AF4DA35CB0F69E39B2A fixFrozenLPTokenTransfer
86E83A7D2ECE3AD5FA87AB2195AE015C950469ABF0B72EAACED318F74886AE90 CryptoConditionsSuite
89308AF3B8B10B7192C4E613E1D2E4D9BA64B2EE2D5232402AE82A6A7220D953 fixQualityUpperBound
8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455 AMM
8EC4304A06AF03BE953EA6EDA494864F6F3F30AA002BABA35869FBB8C6AE5D52 fixInvalidTxFlags
8F81B066ED20DAECA20DF57187767685EEF3980B228E0667A650BAF24426D3B4 fixCheckThreading
93E516234E35E08CA689FA33A6D38E103881F8DCB53023F728C307AA89D515A7 XRPFees
950AE2EA4654E47F04AA8739C0B214E242097E802FD372D24047A89AB1F5EC38 MPTokensV1
955DF3FA5891195A9DAEFA1DDC6BB244B545DDE1BAA84CBB25D5F12A8DA68A0C TicketBatch
96FD2F293A519AE1DB6F8BED23E4AD9119342DA7CB6BAFD00953D16C54205D8B PriceOracle
98DECF327BF79997AEC178323AD51A830E457BFC6D454DAF3E46E5EC42DC619F CheckCashMakesTrustLine
9196110C23EA879B4229E51C286180C7D02166DA712559F634372F5264D0EC59 fixInnerObjTemplate2
A730EB18A9D4BB52502C898589558B4CCEB4BE10044500EE5581137A2E80E849 PermissionedDomains
AB8D932A5F338903FE5BCBD80B611FFED70839ABA3170E9CE01D947C0EDEDCF2 fixMPTDeliveredAmount
AE35ABDEFBDE520372B31C957020B34A7A4A9DC3115A69803A44016477C84D6E fixNFTokenRemint
AF8DF7465C338AE64B1E937D6C8DA138C0D63AD5134A68792BBBE1F63356C422 FlowSortStrands
B2A4DB846F0891BF2C76AB2F2ACC8F5B4EC64437135C6E56F3F859DE5FFD5856 ExpandedSignerList
B32752F7DCC41FB86534118FC4EEC8F56E7BD0A7DB60FD73F93F257233C08E3A fixEnforceNFTokenTrustlineV2
B4D44CC3111ADD964E846FC57760C8B50FFCD5A82C86A72756F6B058DDDF96AD fix1201
B6B3EEDC0267AB50491FDC450A398AF30DBCD977CECED8BEF2499CAB5DAC19E2 fixRmSmallIncreasedQOffers
726F944886BCDF7433203787E93DD9AA87FAB74DFE3AF4785BA03BEFC97ADA1F AMMClawback
763C37B352BE8C7A04E810F8E462644C45AFEAD624BF3894A08E5C917CF9FF39 fixEnforceNFTokenTrustline
C393B3AEEBF575E475F0C60D5E4241B2070CC4D0EB6C4846B1A07508FAEFC485 fixInnerObjTemplate
C4483A1896170C66C098DEA5B0E024309C60DC960DE5F01CD7AF986AA3D9AD37 fixMasterKeyAsRegularKey
C7981B764EC4439123A86CC7CCBA436E9B3FF73B3F10A0AE51882E404522FC41 fixNFTokenPageLinks
CC5ABAE4F3EC92E94A59B1908C2BE82D2228B6485C00AFF8F22DF930D89C194E SortedDirectories
D3456A862DC07E382827981CA02E21946E641877F19B8889031CC57FDCAC83E2 fixPayChanCancelAfter
DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109 DID
DC9CA96AEA1DCF83E527D1AFC916EFAF5D27388ECA4060A88817C1238CAEE0BF EnforceInvariants
DF8B4536989BDACE3F934F29423848B9F1D76D09BE6A1FCFE7E7F06AA26ABEAD fixRemoveNFTokenAutoTrustLine
EE3CF852F0506782D05E65D49E5DCC3D16D50898CD1B646BAE274863401CC3CE NFTokenMintOffer
F1ED6B4A411D8B872E65B9DCB4C8B100375B0DD3D62D07192E011D6D7F339013 fixTrustLinesToSelf
F64E1EABBE79D55B3BB82020516CEC2C582A98A6BFE20FBE9BB6A0D233418064 DepositAuth
FF2D1E13CF6D22427111B967BD504917F63A900CECD320D6FD3AC9FA90344631 fixPriceOracleOrder
# Amendments enabled on mainnet after the initial 3.1.1 list was captured.
# Hashes verified against s1.ripple.com (feature RPC) on 2026-03-30.
138B968F25822EFBF54C00F97031221C47B1EAB8321D93C7C2AEAF85F04EC5DF TokenEscrow
1D3463A5891F9E589C5AE839FFAC4A917CE96197098A1EF22304E1BC5B98A454 fix1528
32B8614321F7E070419115ABEAB1742EA20F3E3AF34432B5E2F474F8083260DC fixTokenEscrowV1
5D08145F0A4983F23AFFFF514E83FAD355C5ABFBB6CAB76FB5BC8519FF5F33BE fix1515
677E401A423E3708363A36BA8B3A7D019D21AC5ABD00387BDBEA6BDE4C91247E PermissionedDEX
7117E2EC2DBF119CA55181D69819F1999ECEE1A0225A7FD2B9ED47940968479C fix1571
B9E739B8296B4A1BB29BE990B17D66E21B62A300A909F25AC55C22D6C72E1F9D fix1523
C1CE18F2A268E6A849C27B3DE485006771B4C01B2FCEC4F18356FE92ECD6BB74 DynamicNFT
CA7C02118BA27599528543DFE77BA6838D1B0F43B447D4D7F53523CE6A0E9AC2 fix1543
DAF3A6EB04FA5DC51E8E4F23E9B7022B693EFA636F23F22664746C77B5786B23 DeepFreeze
E2E6F2866106419B88C50045ACE96368558C345566AC8F2BDF5A5B5587F0E6FA fix1368
FBD513F1B893AC765B78F250E6FFA6A11B573209D1842ADC787C850696741288 fix1578
42426C4D4F1009EE67080A9B7965B44656D7714D104A72F9B4369F97ABF044EE FeeEscalation
B4E4F5D2D6FB84DF7399960A732309C9FD530EAE5941838160042833625A6076 NegativeUNL
# sync:end
`.trim();
}

/**
 * Write a minimal standalone rippled.cfg that exposes the WebSocket admin port
 * on 0.0.0.0 so the faucet container can reach it via host.docker.internal.
 * Also writes a companion validators.txt required by the [amendments] section.
 */
export function writeRippledConfig(debug = false): void {
  if (!fs.existsSync(XRPL_UP_DIR)) {
    fs.mkdirSync(XRPL_UP_DIR, { recursive: true });
  }
  let cfg = generateRippledConfig(debug);

  // Merge any amendments added via `xrpl-up amendment enable --local`
  if (fs.existsSync(EXTRA_AMENDMENTS_FILE)) {
    const extra = fs.readFileSync(EXTRA_AMENDMENTS_FILE, 'utf-8').trim();
    if (extra) {
      const merged = cfg.replace('# sync:end', extra + '\n# sync:end');
      if (merged === cfg) {
        throw new Error(
          'writeRippledConfig: "# sync:end" sentinel not found in generated config — ' +
          'extra amendments could not be merged. Check the generateRippledConfig template.'
        );
      }
      cfg = merged;
    }
  }

  fs.writeFileSync(RIPPLED_CFG_FILE, cfg, 'utf-8');
  // The [amendments] section in rippled.cfg requires a validators_file with a
  // [validators] section (even empty). Write a minimal one alongside rippled.cfg.
  if (!fs.existsSync(VALIDATORS_CFG_FILE)) {
    fs.writeFileSync(VALIDATORS_CFG_FILE, '[validators]\n', 'utf-8');
  }
}

/**
 * Generate and write docker-compose.yml to ~/.xrpl-up/.
 * @param configPath - optional path to a custom rippled.cfg; if omitted, the
 *   default config is auto-generated and written to RIPPLED_CFG_FILE.
 */
export function writeComposeFile(image = DEFAULT_IMAGE, persist = false, debug = false, ledgerIntervalMs = 0, configPath?: string, noRestart = false): string {
  if (!fs.existsSync(XRPL_UP_DIR)) {
    fs.mkdirSync(XRPL_UP_DIR, { recursive: true });
  }

  // Use custom config if provided, otherwise auto-generate the default
  const resolvedConfigPath = configPath
    ? path.resolve(configPath)
    : RIPPLED_CFG_FILE;

  if (!configPath) {
    writeRippledConfig(debug);
  }

  // Determine validators.txt to mount alongside the rippled.cfg.
  // For auto-generated configs, use the companion file in ~/.xrpl-up/.
  // For custom configs, look for validators.txt next to the config file.
  const customValidatorsPath = configPath
    ? path.join(path.dirname(path.resolve(configPath)), 'validators.txt')
    : null;
  const resolvedValidatorsPath =
    customValidatorsPath && fs.existsSync(customValidatorsPath)
      ? customValidatorsPath
      : VALIDATORS_CFG_FILE;

  const faucetContext = getFaucetBuildContext();

  // In persist mode, mount a named volume for the NuDB database so ledger
  // state survives container restarts. In ephemeral mode, no volume is declared
  // and the database lives only in the container's writable layer.
  const dbVolume = persist
    ? `      - rippled-db:/var/lib/rippled/db`
    : '';
  const volumesSection = persist
    ? `\nvolumes:\n  rippled-db:\n    name: xrpl-up-local-db`
    : '';

  // Only force linux/amd64 on ARM hosts (e.g. Apple Silicon) where the
  // official xrpld image ships amd64-only and needs Rosetta 2 emulation.
  // On native x86_64 hosts the field is unnecessary and omitted.
  const platformLine = os.arch() === 'arm64' ? '\n    platform: linux/amd64' : '';

  // In --exit-on-crash mode we need the container to exit with code 134
  // (SIGABRT) when rippled crashes.
  //
  // Root-cause chain:
  //   1. The stock entrypoint uses `exec rippled`, making rippled PID 1.
  //      Linux silently drops unhandled signals for PID 1, so std::abort()
  //      logs the "Logic error:" but the process keeps running.
  //   2. Overriding the entrypoint with a /bin/sh wrapper (no exec) makes
  //      rippled a non-PID-1 child, so signals are delivered.  But the
  //      release build of rippled 3.1.1 appears to exit 0 after abort()
  //      rather than terminating via SIGABRT (possibly an atexit handler
  //      or a custom terminate handler that calls exit(0)).
  //
  // Fix: the shell wrapper redirects rippled's stderr to /tmp/rip.err, then
  // after rippled exits checks that file for "Logic error:".  If found it
  // flushes stderr to docker logs and exits 134.  This gives `docker wait`
  // the correct exit code regardless of how rippled's abort() manifests.
  // `restart: "no"` prevents Docker from recycling the exited container.
  const restartLine = noRestart ? '\n    restart: "no"' : '';

  // rippled standalone mode does not write a SQLite ledger index (only NuDB and
  // peerfinder.sqlite are created). Starting with "-a" alone always fails with
  // "Ledger not found". The ONLY way to resume from an existing NuDB snapshot
  // is "--ledger <hash>".
  //
  // Strategy:
  //   - snapshot restore writes the validated ledger hash to .restore-hash
  //   - entrypoint reads it and passes --ledger <hash>, then deletes the file
  //   - if no hash file (first boot or after reset): use --start for genesis
  const RIPPLED_BIN  = '/opt/ripple/bin/rippled';
  const RIPPLED_CFG  = '--conf /config/rippled.cfg';
  const HASH_FILE    = '/var/lib/rippled/db/.restore-hash';
  const entrypointLine = noRestart
    ? `\n    entrypoint: ["/bin/sh", "-c", "${RIPPLED_BIN} ${RIPPLED_CFG} -a --start 2>/tmp/rip.err & RPID=$! ; wait $RPID ; EC=$? ; cat /tmp/rip.err >&2 ; grep -qF Logic\\ error: /tmp/rip.err 2>/dev/null && exit 134 ; exit $EC"]`
    : persist
      ? `\n    entrypoint: ["/bin/sh", "-c", "if [ -f ${HASH_FILE} ]; then HASH=$(cat ${HASH_FILE}); rm -f ${HASH_FILE}; exec ${RIPPLED_BIN} ${RIPPLED_CFG} -a --ledger $HASH; else exec ${RIPPLED_BIN} ${RIPPLED_CFG} -a --start; fi"]`
      : '';
  const commandLine = (noRestart || persist)
    ? ''  // entrypoint already contains the full rippled invocation
    : '\n    command: ["-a", "--start"]';

  const yaml = `# Generated by xrpl-up — do not edit manually
# Regenerated on every 'xrpl-up node --local' run

name: ${COMPOSE_PROJECT}

services:
  rippled:
    image: ${image}${platformLine}${restartLine}${entrypointLine}${commandLine}
    ports:
      - "${LOCAL_WS_PORT}:${LOCAL_WS_PORT}"
    volumes:
      - "${resolvedConfigPath}:/config/rippled.cfg:ro"
      - "${resolvedValidatorsPath}:/config/validators.txt:ro"
${dbVolume}
    networks:
      - xrpl-net
    healthcheck:
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/${LOCAL_WS_PORT}"]
      interval: 2s
      timeout: 2s
      retries: 20
      start_period: 5s

  faucet:
    build:
      context: ${faucetContext}
      dockerfile: Dockerfile
    environment:
      - RIPPLED_WS_URL=ws://host.docker.internal:${LOCAL_WS_PORT}
      - FAUCET_PORT=${FAUCET_PORT}
      - FUND_AMOUNT_XRP=1000
      - LEDGER_INTERVAL_MS=${ledgerIntervalMs}
    ports:
      - "${FAUCET_PORT}:${FAUCET_PORT}"
    networks:
      - xrpl-net
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      rippled:
        condition: service_healthy

networks:
  xrpl-net:
    driver: bridge
${volumesSection}
`;

  fs.writeFileSync(COMPOSE_FILE, yaml, 'utf-8');
  return COMPOSE_FILE;
}

/** Read the rippled image from the current compose file (for use in restore). */
export function readComposeImage(): string {
  try {
    const content = fs.readFileSync(COMPOSE_FILE, 'utf-8');
    const match = content.match(/^\s+image:\s+(.+)$/m);
    return match?.[1]?.trim() ?? DEFAULT_IMAGE;
  } catch {
    return DEFAULT_IMAGE;
  }
}

/** Read the faucet ledger interval from the current compose file. */
export function readComposeLedgerInterval(): number {
  try {
    const content = fs.readFileSync(COMPOSE_FILE, 'utf-8');
    const match = content.match(/LEDGER_INTERVAL_MS=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/** Stop a single service without removing containers or volumes. */
export function stopService(service: string): void {
  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" stop ${service}`,
    { stdio: 'ignore' }
  );
}

/** Start a previously stopped service (or create it if the container is missing).
 *
 * --no-deps skips the depends_on health-check gate so the faucet can be
 * started independently after we have already confirmed rippled is ready.
 */
export function startService(service: string): void {
  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up -d --no-deps ${service}`,
    { stdio: 'ignore' }
  );
}

/** Run `docker compose down` (removes containers, keeps volumes). */
export function composeDown(): void {
  try {
    execSync(
      `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" down`,
      { stdio: 'ignore' }
    );
  } catch {
    // already gone or never started
  }
}

/**
 * Start the compose stack (`docker compose up --build -d`),
 * wait for both ports to be reachable, and return the WebSocket URL.
 *
 * When `persist` is true, the rippled NuDB volume is preserved across restarts.
 * When false (default), containers are torn down clean before starting.
 */
export async function composeUp(image = DEFAULT_IMAGE, persist = false, debug = false, ledgerIntervalMs = 0, configPath?: string, noRestart = false): Promise<string> {
  writeComposeFile(image, persist, debug, ledgerIntervalMs, configPath, noRestart);
  if (!persist) composeDown(); // clean slate only in ephemeral mode

  execSync(
    `docker compose -p ${COMPOSE_PROJECT} -f "${COMPOSE_FILE}" up --build -d`,
    { stdio: 'ignore' }
  );

  // Wait for rippled WebSocket port then faucet HTTP port
  await waitForPort(LOCAL_WS_PORT, 30_000, 'rippled WebSocket');
  await waitForPort(FAUCET_PORT, 30_000, 'faucet HTTP');

  return LOCAL_WS_URL;
}

/**
 * Spawn `docker compose logs --follow [service]` and stream to the caller's
 * stdout/stderr. Returns the child process so the caller can handle termination.
 */
export function composeLogs(service?: string): ChildProcess {
  const args = [
    'compose',
    '-p', COMPOSE_PROJECT,
    '-f', COMPOSE_FILE,
    'logs',
    '--follow',
    '--no-log-prefix',
  ];
  if (service) args.push(service);

  return spawn('docker', args, { stdio: 'inherit' });
}

export function waitForPort(port: number, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      const onFail = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(
            new Error(
              `${label} did not become reachable on port ${port} within ${timeoutMs / 1000}s`
            )
          );
        } else {
          setTimeout(attempt, 1000);
        }
      };
      socket.once('error', onFail);
      socket.once('timeout', onFail);
      socket.connect(port, '127.0.0.1');
    }
    // Give Docker a moment before the first probe
    setTimeout(attempt, 2000);
  });
}
