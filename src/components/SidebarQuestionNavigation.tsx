import { FilterPanel } from "./QuestionFilterPanel.js";
import { QuestionList } from "./QuestionList.js";

export function SidebarQuestionNavigation() {
  return (
    <>
      <FilterPanel />
      <QuestionList />
    </>
  );
}

