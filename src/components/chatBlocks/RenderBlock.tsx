import type { Block } from "../../lib/chatBlocks/types";
import { renderExtendedBlock } from "./ExtendedBlockRenderer";
import { BadgeBlockView } from "./BadgeBlock";
import { CalloutBlockView } from "./CalloutBlock";
import { DividerBlockView } from "./DividerBlock";
import { HeadingBlockView } from "./HeadingBlock";
import { ColumnBlockView, GridBlockView, RowBlockView } from "./layout/LayoutBlocks";
import { AccordionBlockView, TabsBlockView } from "./layout/TabsAccordion";
import { StatBlockView } from "./StatBlock";
import { TableBlockView } from "./TableBlock";
import { TextBlockView } from "./TextBlock";
import { AllocationBlockView } from "./wealth/AllocationBlock";
import { BenchmarkComparisonBlockView } from "./wealth/BenchmarkComparisonBlock";
import { FundCardBlockView } from "./wealth/FundCardBlock";
import { HoldingsTableBlockView } from "./wealth/HoldingsTableBlock";
import { PeriodReturnsBlockView } from "./wealth/PeriodReturnsBlock";
import { PortfolioSummaryBlockView } from "./wealth/PortfolioSummaryBlock";
import { SectorExposureBlockView } from "./wealth/SectorExposureBlock";

export function RenderBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return <TextBlockView block={block} />;
    case "heading":
      return <HeadingBlockView block={block} />;
    case "stat":
      return <StatBlockView block={block} />;
    case "badge":
      return <BadgeBlockView block={block} />;
    case "table":
      return <TableBlockView block={block} />;
    case "callout":
      return <CalloutBlockView block={block} />;
    case "divider":
      return <DividerBlockView />;
    case "stack":
      return (
        <div className="chat-block-stack">
          {block.children.map((child, i) => (
            <RenderBlock key={i} block={child} />
          ))}
        </div>
      );
    case "row":
      return <RowBlockView block={block} />;
    case "column":
      return <ColumnBlockView block={block} />;
    case "grid":
      return <GridBlockView block={block} />;
    case "tabs":
      return <TabsBlockView block={block} />;
    case "accordion":
      return <AccordionBlockView block={block} />;
    case "portfolioSummary":
      return <PortfolioSummaryBlockView block={block} />;
    case "periodReturns":
      return <PeriodReturnsBlockView block={block} />;
    case "benchmarkComparison":
      return <BenchmarkComparisonBlockView block={block} />;
    case "holdingsTable":
      return <HoldingsTableBlockView block={block} />;
    case "allocation":
      return <AllocationBlockView block={block} />;
    case "fundCard":
      return <FundCardBlockView block={block} />;
    case "sectorExposure":
      return <SectorExposureBlockView block={block} />;
    default:
      return <>{renderExtendedBlock(block)}</>;
  }
}
